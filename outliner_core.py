"""Outliner core: STEP -> exact vector line art (SVG). No AI, pure geometry (OpenCascade HLR).

    parts = load("model.step")                      # [(name, shape)], read once and cache
    svg   = render(parts, "iso", rot=(0, 0, 90))    # SVG string, one <g> per part
    frame = auto_orient(parts)                      # optional: rotation that puts the part in a natural pose

Model is shown Z-up as modelled. `rot` = degrees about the model's X, Y, Z axes (applied X, then Y, then Z).
Views: iso, front, back, left, right, top, bottom.
"""
import math
import numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_LabelSequence, TDF_Label
from OCP.TDataStd import TDataStd_Name
from OCP.TopLoc import TopLoc_Location
from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.HLRBRep import (HLRBRep_Algo, HLRBRep_HLRToShape, HLRBRep_PolyAlgo,
                         HLRBRep_PolyHLRToShape, HLRBRep_TypeOfResultingEdge as Edge)
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.GCPnts import GCPnts_TangentialDeflection
from OCP.GeomAbs import GeomAbs_Line, GeomAbs_BSplineSurface
from OCP.BRep import BRep_Tool, BRep_Builder
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

# view direction (towards the viewer) and the screen's right-hand axis, in model coordinates (Z up)
VIEWS = {
    'iso':    ((1, -1, 1), (1, 1, 0)),
    'front':  ((0, -1, 0), (1, 0, 0)),
    'back':   ((0, 1, 0), (-1, 0, 0)),
    'left':   ((-1, 0, 0), (0, -1, 0)),
    'right':  ((1, 0, 0), (0, 1, 0)),
    'top':    ((0, 0, 1), (1, 0, 0)),
    'bottom': ((0, 0, -1), (1, 0, 0)),
}


# ---------- reading

def load(path, unify=True):
    """Leaf shapes of a STEP file with their assembly path names, placed in model space."""
    doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))
    r = STEPCAFControl_Reader(); r.SetNameMode(True)
    if r.ReadFile(path) != 1: raise ValueError('Could not read STEP file')
    r.Transfer(doc)
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main()); out = []

    def name(l):
        a = TDataStd_Name()
        return a.Get().ToExtString() if l.FindAttribute(TDataStd_Name.GetID_s(), a) else ''

    def walk(l, loc, path):
        if st.IsReference_s(l):
            ref = TDF_Label(); st.GetReferredShape_s(l, ref)
            walk(ref, loc.Multiplied(st.GetLocation_s(l)), path + [name(l)])
        elif st.IsAssembly_s(l):
            s = TDF_LabelSequence(); st.GetComponents_s(l, s)
            for i in range(1, s.Length() + 1): walk(s.Value(i), loc, path)
        else:
            shape = st.GetShape_s(l).Moved(loc)
            if not TopExp_Explorer(shape, TopAbs_FACE).More():
                return   # curves or points only (e.g. a sketched spring path): nothing solid to draw
            # Merge faces split on the same plane/cylinder (removes seam lines). Skipped for parts with
            # free-form (B-spline) faces, e.g. modelled threads: there it can run for minutes or hang.
            if unify and not _bspline_faces([shape]):
                u = ShapeUpgrade_UnifySameDomain(shape, True, True, False); u.Build(); shape = u.Shape()
            out.append(('/'.join(p for p in path + [name(l)] if p), shape))

    roots = TDF_LabelSequence(); st.GetFreeShapes(roots)
    for i in range(1, roots.Length() + 1): walk(roots.Value(i), TopLoc_Location(), [])
    if not out: raise ValueError('No solids found in STEP file')
    return out


def _compound(shapes):
    b = BRep_Builder(); c = TopoDS_Compound(); b.MakeCompound(c)
    for s in shapes: b.Add(c, s)
    return c


def _diag(shape):
    bb = Bnd_Box(); BRepBndLib.Add_s(shape, bb); q = bb.Get()
    return math.dist(q[:3], q[3:])


def _bspline_faces(shapes):
    n = 0
    for s in shapes:
        ex = TopExp_Explorer(s, TopAbs_FACE)
        while ex.More():
            if BRepAdaptor_Surface(TopoDS.Face_s(ex.Current())).GetType() == GeomAbs_BSplineSurface: n += 1
            ex.Next()
    return n


def is_heavy(parts):
    """Too big to draw exact lines for every angle while rotating (a view takes a minute or more):
    over ~3000 faces, or ~1500 with heavy free-form faces. The preview then shows the GPU lines only
    and the exact drawing is made when downloading."""
    shapes = [s for _, s in parts]
    n = 0
    for s in shapes:
        ex = TopExp_Explorer(s, TopAbs_FACE)
        while ex.More(): n += 1; ex.Next()
    import os
    limit = int(os.environ.get('OUTLINER_HEAVY_FACES', 3000))   # override for testing
    return n > limit or (n > limit // 2 and _heavy_freeform(shapes))


def _heavy_freeform(shapes):
    """Exact HLR gets very slow on free-form models: many B-spline faces (a wrench), or one very
    detailed B-spline face (modelled threads: 300+ control points took 26 s for a 0.5 MB file)."""
    n = 0
    for s in shapes:
        ex = TopExp_Explorer(s, TopAbs_FACE)
        while ex.More():
            a = BRepAdaptor_Surface(TopoDS.Face_s(ex.Current()))
            if a.GetType() == GeomAbs_BSplineSurface:
                n += 1
                if n > 40 or a.NbUPoles() * a.NbVPoles() > 150: return True
            ex.Next()
    return False


# ---------- orientation

def rotation_matrix(rot):
    """Degrees about model X, then Y, then Z."""
    ax, ay, az = (math.radians(a) for a in rot)
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def auto_orient(parts):
    """Suggest a natural pose (optional 'Auto' button). Returns a 3x3 matrix to pass as `frame=`.
    Long/turned parts stand on their axis (wide end up), flat parts lie flat, everything else stays Z-up."""
    shape = _compound([s for _, s in parts])
    BRepMesh_IncrementalMesh(shape, max(_diag(shape) / 300, 0.05), False, 0.5, True)
    pts = []; ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        loc = TopLoc_Location(); tri = BRep_Tool.Triangulation_s(TopoDS.Face_s(ex.Current()), loc)
        if tri is not None:
            tr = loc.Transformation()
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(tr); pts.append((p.X(), p.Y(), p.Z()))
        ex.Next()
    Q = np.array(pts); Q = Q - Q.mean(0)
    _, V = np.linalg.eigh(np.cov(Q.T))
    ext = np.array([np.ptp(Q @ V[:, i]) for i in range(3)]); o = np.argsort(-ext); ext, V = ext[o], V[:, o]
    e1, e2, e3 = V.T

    def wide_up(a):
        t = Q @ a; r = np.linalg.norm(Q - np.outer(t, a), axis=1); lo, hi = np.percentile(t, [12, 88])
        return a if r[t >= hi].max() >= r[t <= lo].max() else -a

    flat = ext[2] < 0.4 * ext[1]
    round_ = abs(ext[1] - ext[2]) / ext[1] < 0.08 and ext[0] > 1.08 * ext[1]
    if round_: up, X = wide_up(e1), e2
    elif flat: up, X = (e3 if e3[2] >= 0 else -e3), e1
    elif ext[0] > 1.6 * ext[1]: up, X = wide_up(e1), e2
    else: return np.eye(3)

    def snap(v):
        i = int(np.argmax(np.abs(v)))
        if abs(v[i]) > 0.995: w = np.zeros(3); w[i] = np.sign(v[i]); return w
        return v / np.linalg.norm(v)

    up = snap(up); X = snap(X - up * (X @ up)); X = X - up * (X @ up); X /= np.linalg.norm(X)
    return np.array([X, np.cross(up, X), up])    # rows: new X, Y, Z expressed in model coords


# ---------- drawing

_ANG = math.radians(2)


def _polylines(compound, defl):
    out = []
    if compound is None or compound.IsNull(): return out
    ex = TopExp_Explorer(compound, TopAbs_EDGE)
    while ex.More():
        c = BRepAdaptor_Curve(TopoDS.Edge_s(ex.Current()))
        u0, u1 = c.FirstParameter(), c.LastParameter()
        if c.GetType() == GeomAbs_Line:
            pts = [c.Value(u0), c.Value(u1)]
        else:
            # At most 2° of turn per segment and a tight chord error, so arcs and fillets stay smooth
            # at any zoom, like a true vector export (chord error alone gave ~19° facets on fillets).
            d = GCPnts_TangentialDeflection(c, _ANG, defl / 4, 2)
            pts = [d.Value(i) for i in range(1, d.NbPoints() + 1)] if d.NbPoints() > 1 \
                else [c.Value(u0 + (u1 - u0) * k / 64) for k in range(65)]
        out.append([(p.X(), p.Y()) for p in pts])
        ex.Next()
    return out


def _chain(pls, tol=0.01):
    from collections import defaultdict
    key = lambda p: (round(p[0] / tol), round(p[1] / tol)); ends = defaultdict(list)
    for i, pl in enumerate(pls): ends[key(pl[0])].append(i); ends[key(pl[-1])].append(i)
    used = [False] * len(pls); out = []
    for i in range(len(pls)):
        if used[i]: continue
        used[i] = True; cur = list(pls[i])
        for _ in (0, 1):
            while True:
                k = key(cur[-1]); j = next((j for j in ends[k] if not used[j]), None)
                if j is None: break
                used[j] = True; pl = pls[j]; cur += pl[1:] if key(pl[0]) == k else pl[::-1][1:]
            cur.reverse()
        out.append(cur)
    return out


def _rdp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    if math.hypot(a[0] - b[0], a[1] - b[1]) < tol:  # closed loop: split first, or it collapses
        k = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]))
        if 0 < k < len(pts) - 1: return _rdp(pts[:k + 1], tol)[:-1] + _rdp(pts[k:], tol)
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-9
    i, dm = max(((i, abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L) for i, p in enumerate(pts[1:-1], 1)),
                key=lambda t: t[1])
    return _rdp(pts[:i + 1], tol)[:-1] + _rdp(pts[i:], tol) if dm > tol else [a, b]


def _fill_tris(shape, d, x, defl):
    """Triangles of `shape` projected to the same 2D frame as HLR (x = p·x, y = p·(d×x)),
    each wound counter-clockwise so a nonzero fill never cancels out.
    Meshes a copy: OCC stores triangulations on the shape, and HLR output depends on them, so meshing
    the original would make the lines differ depending on whether a filled view was drawn first."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    y = np.cross(d, x)
    shape = BRepBuilderAPI_Copy(shape, True, False).Shape()
    BRepMesh_IncrementalMesh(shape, defl, False, 0.5, True)
    out = []; ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        loc = TopLoc_Location(); tri = BRep_Tool.Triangulation_s(TopoDS.Face_s(ex.Current()), loc)
        if tri is not None:
            tr = loc.Transformation()
            P = []
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(tr); v = (p.X(), p.Y(), p.Z())
                P.append((v[0] * x[0] + v[1] * x[1] + v[2] * x[2], v[0] * y[0] + v[1] * y[1] + v[2] * y[2]))
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = (P[k - 1] for k in tri.Triangle(i).Get())
                area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
                if abs(area) < 1e-12: continue
                out.append((a, b, c) if area > 0 else (a, c, b))
        ex.Next()
    return out


def fill_mesh(parts):
    """Coarse triangles of every part, made once per file for the preview fill (see render(fill=)).
    Returns [(nodes (n,3), triangles (m,3) int, bbox centre (3,))] in model space. Meshes copies, so
    the shapes used for the lines are never touched."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    defl = max(_diag(_compound([s for _, s in parts])) / 400, 0.01)
    out = []
    for _, shape in parts:
        cp = BRepBuilderAPI_Copy(shape, True, False).Shape()
        BRepMesh_IncrementalMesh(cp, defl, False, 0.5, True)
        nodes, tris = [], []
        ex = TopExp_Explorer(cp, TopAbs_FACE)
        while ex.More():
            loc = TopLoc_Location(); tri = BRep_Tool.Triangulation_s(TopoDS.Face_s(ex.Current()), loc)
            if tri is not None:
                tr = loc.Transformation(); base = len(nodes)
                for i in range(1, tri.NbNodes() + 1):
                    p = tri.Node(i).Transformed(tr); nodes.append((p.X(), p.Y(), p.Z()))
                for i in range(1, tri.NbTriangles() + 1):
                    a, b, c = tri.Triangle(i).Get(); tris.append((base + a - 1, base + b - 1, base + c - 1))
            ex.Next()
        bb = Bnd_Box(); BRepBndLib.Add_s(shape, bb); q = bb.Get()
        out.append((np.asarray(nodes, float).reshape(-1, 3), np.asarray(tris, np.int64).reshape(-1, 3),
                    np.array([(q[k] + q[k + 3]) / 2 for k in range(3)])))
    return out


def preview_scene(parts):
    """What the browser needs to draw a geometrically correct line preview on the GPU while the exact
    drawing is computed, made once per file. Per part: a fine mesh of a copy (nodes, triangles with
    their face id, consistently wound), its bbox centre, and the real B-rep edges that exact HLR draws
    (sharp C0 and tangent G1/C1 edges; no seams, degenerate or smoother edges) as 3D polylines sampled
    like the drawing's lines. Visibility is then decided by a real depth buffer of the real geometry."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape
    from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1, GeomAbs_C1
    from OCP.TopAbs import TopAbs_REVERSED
    diag = _diag(_compound([s for _, s in parts]))
    mdefl = max(diag / 2000, 0.005)
    edefl = max(diag / 4000, 0.0005) / 4
    out = []
    for _, shape in parts:
        cp = BRepBuilderAPI_Copy(shape, True, False).Shape()
        BRepMesh_IncrementalMesh(cp, mdefl, False, 0.2, True)
        nodes, tris, fids = [], [], []
        fmap = TopTools_IndexedMapOfShape(); TopExp.MapShapes_s(cp, TopAbs_FACE, fmap)
        for fi in range(1, fmap.Extent() + 1):
            face = TopoDS.Face_s(fmap.FindKey(fi))
            loc = TopLoc_Location(); tri = BRep_Tool.Triangulation_s(face, loc)
            if tri is None: continue
            tr = loc.Transformation(); base = len(nodes); rev = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(tr); nodes.append((p.X(), p.Y(), p.Z()))
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                tris.append((base + a - 1, base + c - 1, base + b - 1) if rev else (base + a - 1, base + b - 1, base + c - 1))
                fids.append(fi)
        emap = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(shape, TopAbs_EDGE, TopAbs_FACE, emap)
        edges = []
        for ei in range(1, emap.Extent() + 1):
            e = TopoDS.Edge_s(emap.FindKey(ei))
            if BRep_Tool.Degenerated_s(e): continue
            faces = list(emap.FindFromIndex(ei))
            if len(faces) == 2:
                f1, f2 = TopoDS.Face_s(faces[0]), TopoDS.Face_s(faces[1])
                if f1.IsSame(f2): continue                                   # seam
                if BRep_Tool.Continuity_s(e, f1, f2) not in (GeomAbs_C0, GeomAbs_G1, GeomAbs_C1): continue
            cu = BRepAdaptor_Curve(e)
            if cu.GetType() == GeomAbs_Line:
                pts = [cu.Value(cu.FirstParameter()), cu.Value(cu.LastParameter())]
            else:
                d = GCPnts_TangentialDeflection(cu, _ANG, edefl, 2)
                pts = [d.Value(i) for i in range(1, d.NbPoints() + 1)]
            edges.append(np.asarray([(p.X(), p.Y(), p.Z()) for p in pts], np.float32))
        bb = Bnd_Box(); BRepBndLib.Add_s(shape, bb); q = bb.Get()
        out.append({'nodes': np.asarray(nodes, np.float32).reshape(-1, 3), 'tris': np.asarray(tris, np.uint32).reshape(-1, 3),
                    'fids': np.asarray(fids, np.uint32), 'edges': edges,
                    'centre': np.asarray([(q[0] + q[3]) / 2, (q[1] + q[4]) / 2, (q[2] + q[5]) / 2], np.float32)})
    return out


def camera(view='iso', rot=(0, 0, 0), frame=None):
    """View direction d and screen-right x in model coordinates, after rotating the model by R.
    Canonical: rounded to 12 decimals, so rotations that reach the same camera by different routes
    (which differ only in float noise) give bit-identical vectors and therefore identical drawings."""
    R = rotation_matrix(rot) @ (frame if frame is not None else np.eye(3))
    d, x = (np.array(v, float) for v in VIEWS[view])
    d, x = R.T @ (d / np.linalg.norm(d)), R.T @ (x / np.linalg.norm(x))
    d, x = np.round(d, 12) + 0.0, np.round(x, 12) + 0.0
    return d / np.linalg.norm(d), x / np.linalg.norm(x)


def camera_key(view='iso', rot=(0, 0, 0), frame=None):
    """Hashable key: views/rotations that give the same camera give the same drawing."""
    d, x = camera(view, rot, frame)
    return tuple(float(v) for v in (*d, *x))


def _circles(compound):
    """(cx, cy, r, a0, a1, am) of every projected edge that is a true circle or arc (exact HLR keeps curve
    types): centre, radius, and the angles of its start, end and middle, so a client can tell which part
    of the circle the edge is (a fillet is a quarter, a hole a full circle)."""
    from OCP.GeomAbs import GeomAbs_Circle
    out = []
    if compound is None or compound.IsNull(): return out
    ex = TopExp_Explorer(compound, TopAbs_EDGE)
    while ex.More():
        c = BRepAdaptor_Curve(TopoDS.Edge_s(ex.Current()))
        if c.GetType() == GeomAbs_Circle:
            ci = c.Circle(); o = ci.Location(); u0, u1 = c.FirstParameter(), c.LastParameter()
            ang = lambda u: math.atan2(c.Value(u).Y() - o.Y(), c.Value(u).X() - o.X())
            out.append((o.X(), o.Y(), ci.Radius(), ang(u0), ang(u1), ang((u0 + u1) / 2)))
        ex.Next()
    return out


def project(parts, view='iso', rot=(0, 0, 0), frame=None, only=None, algo='auto', smooth=True):
    """Hidden-line projection of one view, in model units (mm), without any SVG.
    Returns {'drawn': [(i, polylines)], 'circles': {i: [(cx, cy, r, a0, a1, am)]}, 'algo', 'camera': (d, x)}.
    Coordinates: x = screen right, y = screen up. Circles come from exact HLR only (poly HLR has
    no curve types), deduplicated per part. render() draws exactly this."""
    idx = list(range(len(parts))) if only is None else list(only)
    shapes = [parts[i][1] for i in idx]
    if not shapes: raise ValueError('Nothing to draw')
    if algo == 'auto': algo = 'poly' if _heavy_freeform(shapes) else 'exact'
    # rotating the model by R  ==  looking at the unrotated model along R^T d
    d, x = camera(view, rot, frame)
    proj = HLRAlgo_Projector(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(*d), gp_Dir(*x)))
    defl = max(_diag(_compound(shapes)) / 4000, 0.0005)
    circles = {}

    if algo == 'poly':
        al = HLRBRep_PolyAlgo()
        for s in shapes: BRepMesh_IncrementalMesh(s, defl, False, 0.1, True); al.Load(s)
        al.Projector(proj); al.Update(); h = HLRBRep_PolyHLRToShape(); h.Update(al)
        per = lambda s: (_polylines(h.VCompound(s), defl) + _polylines(h.OutLineVCompound(s), defl)
                         + (_polylines(h.Rg1LineVCompound(s), defl) if smooth else []))
    else:
        al = HLRBRep_Algo()
        for s in shapes: al.Add(s)
        al.Projector(proj); al.Update(); al.Hide(); h = HLRBRep_HLRToShape(al)
        kinds = [Edge.HLRBRep_Sharp, Edge.HLRBRep_OutLine] + ([Edge.HLRBRep_Rg1Line] if smooth else [])

        def per(s):
            comps = [h.CompoundOfEdges(s, k, True, False) for k in kinds]
            cs = []
            for comp in comps:   # every kind: holes and bosses, and fillets (tangent edges) seen along their axis
                for c in _circles(comp):
                    if not any(all(abs(c[k] - e[k]) < 1e-6 for k in range(6)) for e in cs):
                        cs.append(c)
            per.circles = cs
            return [pl for comp in comps for pl in _polylines(comp, defl)]

    drawn = []
    for i in idx:
        pls = per(parts[i][1])
        drawn.append((i, _chain([p for p in pls if len(p) > 1])))
        if algo != 'poly' and getattr(per, 'circles', None):
            circles[i] = per.circles
    return {'drawn': drawn, 'circles': circles, 'algo': algo, 'camera': (d, x)}


def render(parts, view='iso', rot=(0, 0, 0), frame=None, only=None, algo='auto',
           width=800, stroke=1.0, color='#C7C7CC', smooth=True, fill=None, fill_cache=None, projection=None):
    """SVG string of one view. parts: from load(). only: indices to draw (isolate).
    algo: 'exact' (sharpest), 'poly' (fast, needed for modelled threads) or 'auto'.
    fill: optional colour; paints each part's projected silhouette (from a coarse mesh) behind the
    lines so the model reads as solid. Bounding box and scale come from the lines only, so the
    drawing is identical with or without fill. fill_cache: fill_mesh(parts), made once per file,
    so each view only projects the triangles (fast) instead of meshing again.
    projection: a project() result for the same view, to reuse its hidden-line work.
    Each part is a <g id="part-i" data-name="..."> so the UI can select it."""
    pr = projection if projection is not None else project(parts, view, rot, frame, only, algo, smooth)
    idx = [i for i, _ in pr['drawn']]
    shapes = [parts[i][1] for i in idx]
    algo = pr['algo']
    d, x = pr['camera']
    drawn = pr['drawn']
    pts = [p for _, pls in drawn for pl in pls for p in pl]
    if not pts: raise ValueError('View is empty')
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = 8; s = (width - 2 * pad) / max(x1 - x0, 1e-6); H = (y1 - y0) * s + 2 * pad
    fills = ''
    if fill:
        # One fill layer under all parts: drawing it inside each part's <g> would let a later part's
        # fill cover an earlier part's visible lines in assemblies.
        T = lambda p: '%.2f %.2f' % ((p[0] - x0) * s + pad, (y1 - p[1]) * s + pad)
        coarse = max(_diag(_compound(shapes)) / 400, 0.01)
        if fill_cache is not None:
            y = np.cross(d, x)

            def tris_path(i):   # project cached triangles, wind them all one way (nonzero never cancels)
                N, Tr, _ = fill_cache[i]
                if not len(Tr): return ''
                P = np.c_[(N @ x - x0) * s + pad, (y1 - N @ y) * s + pad]
                a, b, c = P[Tr[:, 0]], P[Tr[:, 1]], P[Tr[:, 2]]
                area = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
                keep = np.abs(area) > 1e-12 * s * s
                flip = area > 0   # screen y points down, so model-space CCW is screen CW
                b2 = np.where(flip[:, None], c, b); c2 = np.where(flip[:, None], b, c)
                arr = np.hstack([a, b2, c2])[keep]
                return ('M%.2f %.2fL%.2f %.2fL%.2f %.2fZ' * len(arr)) % tuple(arr.ravel())
            fp = ''.join(f'<path data-part="{i}" d="{tris_path(i)}"/>'
                         for i in sorted(idx, key=lambda i: float(fill_cache[i][2] @ d)))
            fills = (f'<g class="fill" fill="{fill}" stroke="{fill}" stroke-width="0.6" '
                     f'stroke-linejoin="round">{fp}</g>')
        else:
            def depth(i):   # bounding-box centre along the view direction (bigger = nearer)
                bb = Bnd_Box(); BRepBndLib.Add_s(parts[i][1], bb); q = bb.Get()
                return sum((q[k] + q[k + 3]) / 2 * d[k] for k in range(3))
            # far → near, so the nearest part's fill is on top for click hit-testing (same colour, so
            # the picture doesn't change)
            fp = ''.join(f'<path data-part="{i}" d="' + ''.join(f'M{T(a)}L{T(b)}L{T(c)}Z' for a, b, c in
                                                                _fill_tris(parts[i][1], d, x, coarse)) + '"/>'
                         for i in sorted(idx, key=depth))
            fills = (f'<g class="fill" fill="{fill}" stroke="{fill}" stroke-width="0.6" '
                     f'stroke-linejoin="round">{fp}</g>')
    groups = []
    for i, pls in drawn:
        dd = ''.join('M' + 'L'.join('%.2f %.2f' % ((p[0] - x0) * s + pad, (y1 - p[1]) * s + pad)
                                    for p in _rdp(pl, 0.05 / s)) for pl in pls)
        name = parts[i][0].replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')
        groups.append(f'<g id="part-{i}" data-name="{name}"><path d="{dd}"/></g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{H:.0f}" '
            f'viewBox="0 0 {width:.0f} {H:.1f}" data-mm-per-px="{1 / s:.5f}" data-algo="{algo}" '
            # how model mm map to this viewBox (svg x = (p·x − x0)·s + pad, svg y = (y1 − p·y)·s + pad,
            # with y = d × x), so a client can draw things exactly under the lines (the preview fill)
            f'data-frame="{x0:.9g} {y1:.9g} {s:.9g} {pad}" '
            f'data-camera="{" ".join(f"{v:.12g}" for v in (*d, *x))}">'
            f'{fills}<g fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" '
            f'stroke-linejoin="round">{"".join(groups)}</g></svg>')


if __name__ == '__main__':   # quick test: python outliner_core.py model.step outdir [views] [rx,ry,rz]
    import sys, os, time
    src, outdir = sys.argv[1], sys.argv[2]
    views = sys.argv[3].split(',') if len(sys.argv) > 3 else ['iso', 'front', 'top']
    rot = tuple(float(v) for v in sys.argv[4].split(',')) if len(sys.argv) > 4 else (0, 0, 0)
    t = time.time(); parts = load(src); print(f'{len(parts)} parts, load {time.time() - t:.2f}s')
    os.makedirs(outdir, exist_ok=True)
    for v in views:
        t = time.time(); svg = render(parts, v, rot)
        open(f'{outdir}/{v}.svg', 'w').write(svg); print(f'{v}: {time.time() - t:.2f}s, {len(svg) / 1024:.0f} kB')
