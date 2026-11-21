"""Sheet layout for production drawings (Drawing mode). Ported from the production-drawing-a4 skill
(prod_drawing.py): 3rd-angle views (TOP above FRONT, RIGHT to the right), a view identical to FRONT is
dropped, automatic scale from the standard list, ISO in the free space.

Input is exact HLR polylines in model millimetres (outliner_core.project). The browser draws the sheet
from the returned placement; nothing here draws lines or text.
"""
import math

import numpy as np

SCALES = [(20, 1), (10, 1), (5, 1), (2, 1), (1, 1), (1, 2), (1, 4), (1, 5), (1, 10), (1, 20), (1, 50)]
SHEETS = {'A4': (297.0, 210.0), 'A3': (420.0, 297.0)}
M = 10.0                     # frame margin
TB_W, TB_H = 112.0, 36.0     # title block
GAP, DS = 24.0, 16.0         # gap between views, room for dimensions around the block
FILL = 0.82                  # auto scale: views + dimensions fill at most this much of their area


def bbox(pls):
    xs = [p[0] for pl in pls for p in pl]; ys = [p[1] for pl in pls for p in pl]
    if not xs:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))


def _raster(pls):
    x0, y0, x1, y1 = bbox(pls); img = np.zeros((120, 120), bool)
    for pl in pls:
        for (ax, ay), (bx, by) in zip(pl, pl[1:]):
            for t in np.linspace(0, 1, 30):
                u = int((ax + (bx - ax) * t - x0) / max(x1 - x0, 1e-9) * 119)
                v = int((ay + (by - ay) * t - y0) / max(y1 - y0, 1e-9) * 119)
                img[max(v - 1, 0):v + 2, max(u - 1, 0):u + 2] = True
    return img, (x1 - x0) / max(y1 - y0, 1e-9)


def same_view(a, b):
    """Two views that show the same outline (e.g. a cylinder's FRONT and RIGHT)."""
    (ia, ra), (ib, rb) = _raster(a), _raster(b)
    return abs(ra - rb) / max(ra, rb) < 0.03 and (ia & ib).sum() / max((ia | ib).sum(), 1) > 0.8


def scale_label(sc):
    for n, d in SCALES:
        if abs(n / d - sc) < 1e-9:
            return f'{n}:{d}'
    return f'1:{1 / sc:g}' if sc < 1 else f'{sc:g}:1'


def layout(views, sheet='A4', orient='landscape', scale='auto'):
    """views: {'front': pls, 'top': pls?, 'right': pls?, 'iso': pls?} in model mm (x right, y up).
    Returns the sheet size, the scale, which views are kept, and per view the paper transform
    (paper x = ox + x·sc, paper y = oy − y·sc) plus its paper rectangle."""
    W, H = SHEETS[sheet]
    if orient == 'portrait':
        W, H = H, W
    names = [n for n in ('front', 'top', 'right') if n in views]
    dropped = []
    if 'right' in names and same_view(views['front'], views['right']):
        names.remove('right'); dropped.append('right')
    elif 'top' in names and same_view(views['front'], views['top']):
        names.remove('top'); dropped.append('top')
    hasT, hasR, hasI = 'top' in names, 'right' in names, 'iso' in views
    F = bbox(views['front']); T = bbox(views['top']) if hasT else None; R = bbox(views['right']) if hasR else None
    Wx, Hz = F[2] - F[0], F[3] - F[1]
    Ty = (T[3] - T[1]) if hasT else 0.0
    Ry = (R[2] - R[0]) if hasR else 0.0

    def block(sc):
        return (Wx * sc + (Ry * sc + GAP if hasR else 0) + 2 * DS, Hz * sc + (Ty * sc + GAP if hasT else 0) + 2 * DS)

    iw, ih = W - 2 * M, H - 2 * M
    if hasI:
        layouts = {'left': (0.60 * iw, ih), 'top': (iw, 0.56 * ih)}
    else:
        layouts = {'full': (iw, ih - TB_H)}

    def fits(sc, frac):
        for lay, (rw, rh) in layouts.items():
            bw, bh = block(sc)
            if bw <= frac * rw and bh <= frac * rh:
                return lay
        return None

    best = None
    for lay, (rw, rh) in layouts.items():
        for n, d in SCALES:
            bw, bh = block(n / d)
            if bw <= FILL * rw and bh <= FILL * rh:
                if best is None or n / d > best[1]:
                    best = (lay, n / d)
                break
    auto_lay, auto_sc = best or (next(iter(layouts)), 1 / 50)
    options = {k: fits(v, 1.0) is not None for k, v in (('1:1', 1.0), ('2:1', 2.0))}
    if scale in ('1:1', '2:1'):
        sc = 1.0 if scale == '1:1' else 2.0
        lay = fits(sc, 1.0) or auto_lay
    else:
        sc, lay = auto_sc, auto_lay

    rw, rh = layouts[lay]; bw, bh = block(sc)
    bx0 = M + (rw - bw) / 2 + DS; by0 = M + (rh - bh) / 2 + DS
    fx = bx0 - F[0] * sc
    fy = by0 + (Ty * sc + GAP if hasT else 0) + F[3] * sc
    out = {'front': {'ox': fx, 'oy': fy, 'sc': sc}}
    if hasT:
        out['top'] = {'ox': fx, 'oy': by0 + T[3] * sc, 'sc': sc}
    if hasR:
        out['right'] = {'ox': bx0 + Wx * sc + GAP - R[0] * sc, 'oy': fy, 'sc': sc}
    if hasI:
        reg = (M + rw, M, W - M, H - M - TB_H) if lay == 'left' else (M, M + rh, W - M - TB_W, H - M)
        I = bbox(views['iso'])
        aw, ah = (reg[2] - reg[0]) - 16, (reg[3] - reg[1]) - 32
        isc = min(sc, aw / max(I[2] - I[0], 1e-9), ah / max(I[3] - I[1], 1e-9))
        cx, cy = (reg[0] + reg[2]) / 2, (reg[1] + reg[3]) / 2 - 8
        out['iso'] = {'ox': cx - (I[0] + I[2]) / 2 * isc, 'oy': cy + (I[1] + I[3]) / 2 * isc, 'sc': isc}
    for name, t in out.items():
        b = bbox(views[name])
        t['rect'] = [t['ox'] + b[0] * t['sc'], t['oy'] - b[3] * t['sc'], t['ox'] + b[2] * t['sc'], t['oy'] - b[1] * t['sc']]
        t['bbox'] = list(b)
    return {'sheet': {'w': W, 'h': H, 'margin': M, 'tb': [TB_W, TB_H]}, 'scale': sc, 'scaleLabel': scale_label(sc),
            'autoScale': scale_label(auto_sc), 'options': options, 'layout': lay, 'dropped': dropped, 'views': out}
