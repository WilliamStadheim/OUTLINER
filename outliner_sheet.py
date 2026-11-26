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
FILL = 0.9                  # auto scale: views + dimensions fill at most this much of their area


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
    # every standard scale, and whether the views + dimensions fit the sheet at it (no clipping)
    options = {f'{n}:{d}': fits(n / d, 1.0) is not None for n, d in SCALES}
    if scale in options and options[scale]:
        n, d = (int(v) for v in scale.split(':'))
        sc = n / d
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
        # The free space next to the views: try the area above the title block and the area beside it,
        # and use whichever lets the ISO be biggest (portrait sheets have a narrow strip beside it).
        if lay == 'left':
            regions = [(M + rw, M, W - M, H - M - TB_H), (M + rw, M, W - M - TB_W, H - M)]
        else:
            regions = [(M, M + rh, W - M, H - M - TB_H), (M, M + rh, W - M - TB_W, H - M)]
        I = bbox(views['iso'])

        def iso_scale(reg):
            aw, ah = (reg[2] - reg[0]) - 16, (reg[3] - reg[1]) - 32
            if aw <= 0 or ah <= 0:
                return 0.0
            # ISO is an illustration: it fills its free space (as in the Figma sheet), up to 3x the sheet scale
            return min(3 * sc, aw / max(I[2] - I[0], 1e-9), ah / max(I[3] - I[1], 1e-9))
        reg = max(regions, key=iso_scale)
        isc = max(iso_scale(reg), 1e-6)
        cx, cy = (reg[0] + reg[2]) / 2, (reg[1] + reg[3]) / 2 - 8
        out['iso'] = {'ox': cx - (I[0] + I[2]) / 2 * isc, 'oy': cy + (I[1] + I[3]) / 2 * isc, 'sc': isc}
    for name, t in out.items():
        b = bbox(views[name])
        t['rect'] = [t['ox'] + b[0] * t['sc'], t['oy'] - b[3] * t['sc'], t['ox'] + b[2] * t['sc'], t['oy'] - b[1] * t['sc']]
        t['bbox'] = list(b)
    return {'sheet': {'w': W, 'h': H, 'margin': M, 'tb': [TB_W, TB_H]}, 'scale': sc, 'scaleLabel': scale_label(sc),
            'autoScale': scale_label(auto_sc), 'options': options, 'layout': lay, 'dropped': dropped, 'views': out}


BAL = 13.0      # room around an exploded view for the balloon rows (ring + gap)
LEG_ROW = 6.0   # one row of the parts legend


def exploded_layout(pls, sheet='A4', orient='landscape', scale='auto', legend_rows=1):
    """One exploded ISO on the sheet, with room around it for the balloon rows and a parts legend at the
    bottom (left of the title block). Same return shape as layout(), with only an 'iso' view."""
    W, H = SHEETS[sheet]
    if orient == 'portrait':
        W, H = H, W
    leg_h = max(TB_H, legend_rows * LEG_ROW + 8)
    rx0, ry0, rx1, ry1 = M + BAL, M + BAL, W - M - BAL, H - M - leg_h - BAL
    b = bbox(pls)
    bw, bh = max(b[2] - b[0], 1e-9), max(b[3] - b[1], 1e-9)

    def fits(sc, frac):
        return bw * sc <= frac * (rx1 - rx0) and bh * sc <= frac * (ry1 - ry0)
    # An exploded ISO is an illustration: it fills its space, at a round scale (steps of 0.5, e.g. 1:7.5)
    fit = FILL * min((rx1 - rx0) / bw, (ry1 - ry0) / bh)
    auto = math.floor(fit * 2) / 2 if fit >= 1 else 1 / (math.ceil(2 / fit) / 2)
    options = {f'{n}:{d}': fits(n / d, 1.0) for n, d in SCALES}
    sc = auto
    if scale in options and options[scale]:
        n, d = (int(v) for v in scale.split(':'))
        sc = n / d
    cx, cy = (rx0 + rx1) / 2, (ry0 + ry1) / 2
    ox, oy = cx - (b[0] + b[2]) / 2 * sc, cy + (b[1] + b[3]) / 2 * sc
    iso = {'ox': ox, 'oy': oy, 'sc': sc, 'bbox': list(b),
           'rect': [ox + b[0] * sc, oy - b[3] * sc, ox + b[2] * sc, oy - b[1] * sc]}
    return {'sheet': {'w': W, 'h': H, 'margin': M, 'tb': [TB_W, TB_H]}, 'scale': sc, 'scaleLabel': scale_label(sc),
            'autoScale': scale_label(auto), 'options': options, 'layout': 'exploded', 'dropped': [],
            'views': {'iso': iso}, 'legend': [M, H - M - leg_h, W - M - TB_W, H - M]}
