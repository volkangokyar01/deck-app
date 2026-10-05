# Volkan Deck — enclosure v4 ("Stream Deck Mini" style)
# One compact wedge: every control on a single tilted face (screen on top, A / B keys + knob below),
# soft rounded corners, flat back cover. Printed FACE-DOWN (smooth face from the bed), no supports.
# Coordinates: x = width, y = depth (front 0 -> back), z = height (desk 0).
# Face frame: X = x, V = up the face (from its bottom edge), N = face normal (outward +, into body -).
import os; HERE=os.path.dirname(os.path.abspath(__file__))
import sys, math, numpy as np
sys.path.insert(0, HERE)
from manifold3d import Manifold, CrossSection, JoinType, OpType
from stlio import load_stl

# ---------------- parameters (mm) ----------------
W, L     = 100.0, 84.0     # face width, face height (along the slope)
ANGLE    = 55.0            # face angle from the desk
TOPD     = 30.0            # top edge depth (perpendicular to the face)
BACK_LEAN = 15.0           # back leans backwards (deg from vertical)
T        = 2.4             # wall
R_FACE   = 10.0            # face corner radius (front view)
R_BACKV  = 8.0             # side/back vertical edges
R_TOPBACK, R_FOOT = 10.0, 4.0
CH       = 1.5             # chamfer around the face (printable on the bed)
CLR      = 0.2
# controls (face frame)
V_SCREEN = 60.0            # glass centre up the face
V_KEYS   = 21.5
KEY_A_X, KEY_B_X, KNOB_X = -33.0, -11.0, 27.0
V_KNOB   = 22.5
MX_HOLE, MX_PLATE, ENC_HOLE, ENC_PLATE = 14.0, 1.5, 7.4, 1.6
PIN_CLR  = 25.0
# T-Display-S3 (board frame: X along length, Y across (up the face), Z normal; glass front Z=0)
PCB_L, PCB_BACK = 60.78, -6.38
ACTIVE   = (12.18, 54.90, -11.35, 11.35)
USB      = dict(x0=-1.2, x1=6.3, yc=-0.14, zc=-3.60)
BTNS     = [(2.3, -9.29), (2.2, 8.81)]
HDR      = (22.7, 53.2)
BAT      = (62.0, 37.0, 14.0)

# ---------------- helpers ----------------
def poly_cs(pts):
    pts = [tuple(map(float, p)) for p in pts]
    ar = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return CrossSection([pts if ar > 0 else pts[::-1]])
def fillet_poly(pts, radii, seg=28):
    P = [np.array(p, float) for p in pts]; out = []
    for i, p1 in enumerate(P):
        r = radii[i]; p0 = P[i - 1]; p2 = P[(i + 1) % len(P)]
        if r <= 0: out.append(tuple(p1)); continue
        d1 = (p0 - p1) / np.linalg.norm(p0 - p1); d2 = (p2 - p1) / np.linalg.norm(p2 - p1)
        th = math.acos(np.clip(d1 @ d2, -1, 1)); tl = r / math.tan(th / 2)
        bis = (d1 + d2) / np.linalg.norm(d1 + d2); c = p1 + bis * r / math.sin(th / 2)
        a = p1 + d1 * tl; b = p1 + d2 * tl
        a0 = math.atan2(*(a - c)[::-1]); a1 = math.atan2(*(b - c)[::-1])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(seg + 1): t = a0 + da * k / seg; out.append((c[0] + r * math.cos(t), c[1] + r * math.sin(t)))
    return out
def box(x0, x1, y0, y1, z0, z1): return Manifold.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))
def rrect(w, h, r, cx=0.0, cy=0.0):
    return CrossSection.square((w - 2 * r, h - 2 * r), center=True).offset(r, JoinType.Round, circular_segments=48).translate((cx, cy))
def along_x(cs, x0, x1):   # (y,z) section extruded along x
    return cs.extrude(x1 - x0).transform(np.array([[0, 0, 1, x0], [1, 0, 0, 0], [0, 1, 0, 0]], float))

a = math.radians(ANGLE)
u = np.array([math.cos(a), math.sin(a)]); n = np.array([-math.sin(a), math.cos(a)])
bl = math.radians(BACK_LEAN)
mv = np.array([math.cos(bl), math.sin(bl)]); wv = np.array([-math.sin(bl), math.cos(bl)])   # back normal / back up
F0 = np.array([0.0, 0.0]); F1 = F0 + L * u; F2 = F1 - TOPD * n
F3 = np.array([F2[0] + F2[1] * math.tan(bl), 0.0])
D_BACK = float(F3 @ mv)    # back plane: p . mv = D_BACK
def face_M(): return np.array([[1, 0, 0, 0], [0, u[0], n[0], 0], [0, u[1], n[1], 0]], float)
def on_face(m): return m.transform(face_M())
def back_M(): return np.array([[1, 0, 0, 0], [0, mv[0], wv[0], F3[0]], [0, mv[1], wv[1], F3[1]]], float)   # local (x, m, w)
def on_back(m): return m.transform(back_M())
def fbox(x0, x1, v0, v1, n0, n1): return on_face(box(x0, x1, v0, v1, n0, n1))

# ---------------- solid ----------------
PROF = poly_cs(fillet_poly([tuple(F0), tuple(F1), tuple(F2), tuple(F3)], [0, 0, R_TOPBACK, R_FOOT]))
sol_a = along_x(PROF, -W / 2 - 1, W / 2 + 1)
# (b) front outline: rounded rectangle, 45 deg chamfer at the face
sol_b = on_face(Manifold.batch_hull([rrect(W - 2 * CH, L - 2 * CH, R_FACE - CH, 0, L / 2).extrude(0.01).translate((0, 0, -0.01)),
                                      rrect(W, L, R_FACE, 0, L / 2).extrude(150).translate((0, 0, -150 - CH))]))   # convex -> exact hull chamfer
# (c) rounded side/back vertical edges
sol_c = on_back(rrect(W, 300, R_BACKV, 0, -150).extrude(200).translate((0, 0, -50)))
solid = sol_a ^ sol_b ^ sol_c
# inner
in_a = along_x(PROF.offset(-T, JoinType.Round, circular_segments=32), -W / 2, W / 2)
in_b = on_face(rrect(W - 2 * T, L - 2 * T, R_FACE - T, 0, L / 2).extrude(150).translate((0, 0, -150 - T)))
in_c = on_back(rrect(W - 2 * T, 300, R_BACKV - T, 0, -150 - T).extrude(200).translate((0, 0, -50)))
inner = in_a ^ in_b ^ in_c
body = solid - inner

# ---------------- face features ----------------
for kx in (KEY_A_X, KEY_B_X):
    body -= fbox(kx - MX_HOLE / 2, kx + MX_HOLE / 2, V_KEYS - MX_HOLE / 2, V_KEYS + MX_HOLE / 2, -T - 1, 1)
    body -= fbox(kx - 8, kx + 8, V_KEYS - 8, V_KEYS + 8, -T - 1, -MX_PLATE)
body -= on_face(Manifold.cylinder(T + 2, ENC_HOLE / 2, circular_segments=48).translate((KNOB_X, V_KNOB, -T - 1)))
body -= fbox(KNOB_X - 7.5, KNOB_X + 7.5, V_KNOB - 7.5, V_KNOB + 7.5, -T - 1, -ENC_PLATE)
# board frame
X_B0 = -(ACTIVE[0] + ACTIVE[1]) / 2
O = V_SCREEN * u - T * n
def board_M(): return np.array([[1, 0, 0, X_B0], [0, u[0], n[0], O[0]], [0, u[1], n[1], O[1]]], float)
def to_board(m): return m.transform(board_M())
def bbox_b(a0, a1, b0, b1, c0, c1): return to_board(box(a0, a1, b0, b1, c0, c1))
def prism_b(poly, a0, a1):
    m = poly_cs(poly).extrude(a1 - a0).transform(np.array([[0, 0, 1, a0], [1, 0, 0, 0], [0, 1, 0, 0]], float))
    return to_board(m)
# screen: shallow recessed bezel + chamfered window
BZ = 0.0     # (no recessed panel: it would be an unsupported ceiling when printed face-down)
bez = rrect(PCB_L + 4, 33, 4, PCB_L / 2 - 1, 0)
body -= to_board((bez - bez.offset(-0.8, JoinType.Round)).extrude(1.5).translate((0, 0, T - 0.45)))   # thin outline groove
wx0, wx1, wy0, wy1 = ACTIVE[0] - 0.5, ACTIVE[1] + 0.5, ACTIVE[2] - 0.5, ACTIVE[3] + 0.5
e = T - BZ
body -= Manifold.batch_hull([bbox_b(wx0, wx1, wy0, wy1, -0.5, 0.01), bbox_b(wx0 - e, wx1 + e, wy0 - e, wy1 + e, e, e + 0.01),
                             bbox_b(wx0 - e, wx1 + e, wy0 - e, wy1 + e, T + 1, T + 1.01)])
for bx, by in BTNS:
    body -= to_board(Manifold.cylinder(T + 2, 1.7, circular_segments=32).translate((bx, by, -1)))
# USB-C: hole in the left wall + guide duct (its end is the left stop)
UW, UH, UR = 14.0, 9.0, 2.5
usb_cs = CrossSection.square((UW - 2 * UR, UH - 2 * UR), center=True).offset(UR, JoinType.Round, circular_segments=24).translate((USB['yc'], USB['zc']))
# 45 deg peak on the side that faces up in the face-down print (-Z): no bridge over the cable hole
usb_cs = (usb_cs + CrossSection.square((0.6, 0.6), center=True).translate((USB['yc'], USB['zc'] - UH / 2 - UW / 2 + 1.5))).hull()
duct_cs = usb_cs.offset(1.6, JoinType.Round, circular_segments=24)
duct_end = USB['x0'] - 0.3
duct = prism_b(list(map(tuple, duct_cs.to_polygons()[0])), -W / 2 + T - 0.5 - X_B0, duct_end) ^ solid ^ bbox_b(-80, 80, -40, 40, -40, 0.5)
body += duct
body -= prism_b(list(map(tuple, usb_cs.to_polygons()[0])), -W / 2 - 2 - X_B0, duct_end + 0.01)
# snap clips at the board ends (perpendicular to the face -> vertical when printed face-down)
CL_T, CL_IN = 1.2, 13.13
def clip(Xa, Xb, s):
    zb = PCB_BACK - 1.9
    beam = [(CL_IN, 0.8), (CL_IN, PCB_BACK - 0.10), (12.30, PCB_BACK - 0.10), (CL_IN, zb), (CL_IN + CL_T, zb), (CL_IN + CL_T, 0.8)]
    return prism_b([(s * y, z) for y, z in beam], Xa, Xb)
clips = [clip(0.4, 4.4, s) for s in (1, -1)] + [clip(55.0, 59.5, s) for s in (1, -1)]
body += Manifold.batch_boolean(clips, OpType.Add)
body += bbox_b(61.08, 64.0, -5, 5, PCB_BACK - 0.6, 0.8)                       # right end stop
# feet recesses
for fx in (-W / 2 + 12, W / 2 - 12):
    for fy in (14.0, F3[0] - 12.0):
        body -= Manifold.cylinder(1.0, 5.2, circular_segments=48).translate((fx, fy, -0.01))

# ---------------- back opening + cover ----------------
OW, OH, OR, OW0 = 76.0, 37.0, 6.0, 8.0          # opening (x, w) on the back plane, from w=OW0
o_cs = rrect(OW, OH, OR, 0, OW0 + OH / 2)
def back_prism(cs, m0, m1):   # cs in (x, w) -> extruded along m
    return on_back(cs.extrude(m1 - m0).transform(np.array([[1, 0, 0, 0], [0, 0, 1, m0], [0, 1, 0, 0]], float)))
body -= back_prism(o_cs, -T - 1, 1)
cover = back_prism(o_cs.offset(-CLR, JoinType.Round), -T, 0) ^ solid
ring = o_cs.offset(-CLR, JoinType.Round) - o_cs.offset(-CLR - 1.4, JoinType.Round)
cover += back_prism(ring, -T - 3.0, -T + 0.01)
def hook(xc, s):   # s=+1 top edge, -1 bottom edge; catches the inner face of the back wall
    wedge = OW0 + OH / 2 + s * (OH / 2 - CLR)
    beam_w0 = wedge - s * 1.4
    hk = back_prism(CrossSection.square((8, 1.4)).translate((xc - 4, min(beam_w0, wedge))), -T - 7.0, -T + 0.01)
    lip = poly_cs([(0, 0), (s * 0.9, 0), (s * 0.9, -1.3), (0, -3.2)])          # (w offset, m offset from -T-0.1)
    lipm = lip.extrude(8).transform(np.array([[0, 0, 1, xc - 4], [0, 1, 0, -T - 0.1], [1, 0, 0, wedge]], float))
    return hk + on_back(lipm)
cover -= back_prism(CrossSection.square((10, 2.0)).translate((-35, OW0 + OH - CLR - 1.8)), -T - 3.2, -T)   # notches for hooks
cover -= back_prism(CrossSection.square((10, 2.0)).translate((25, OW0 + OH - CLR - 1.8)), -T - 3.2, -T)
cover -= back_prism(CrossSection.square((10, 2.0)).translate((-35, OW0 + CLR - 0.2)), -T - 3.2, -T)
cover -= back_prism(CrossSection.square((10, 2.0)).translate((25, OW0 + CLR - 0.2)), -T - 3.2, -T)
cover += Manifold.batch_boolean([hook(xc, s) for xc in (-30.0, 30.0) for s in (1, -1)], OpType.Add)
# pry slot + cable relief none (USB on the side)
body -= back_prism(rrect(12, 3.0, 1.4, 0, OW0 - 1.4), -T - 1, 1) ^ back_prism(rrect(12, 6, 1.4, 0, OW0), -T - 1, 1)

# ---------------- knob / plunger ----------------
KN_D, KN_H = 30.0, 18.0
kn = Manifold.batch_hull([Manifold.cylinder(KN_H - 1.5, KN_D / 2, circular_segments=128), Manifold.cylinder(KN_H, KN_D / 2 - 1.5, circular_segments=128)])
kn -= Manifold.batch_boolean([Manifold.cylinder(KN_H - 5, 0.85, circular_segments=16).translate((KN_D / 2 * math.cos(t), KN_D / 2 * math.sin(t), 2.0))
                              for t in np.linspace(0, 2 * math.pi, 36, endpoint=False)], OpType.Add)
kn -= Manifold.cylinder(6.2, 6.8, circular_segments=64).translate((0, 0, -0.1))
dhole = CrossSection.circle(3.1, 48) ^ CrossSection.square((10, 10), True).translate((0, -5 + 1.6))
kn -= dhole.extrude(10.5).translate((0, 0, 6.0))
kn -= Manifold.cylinder(2.0, 1.0, circular_segments=16).translate((0, KN_D / 2 - 3.6, KN_H - 1.8))
knob = kn
pl = Manifold.cylinder(1.0, 1.4, circular_segments=32)
pl += Manifold.cylinder(1.3, 1.4, 2.7, circular_segments=32).translate((0, 0, 1.0))
pl += Manifold.cylinder(0.25, 2.7, circular_segments=32).translate((0, 0, 2.3))
pl += Manifold.cylinder(T - BZ + 0.7, 1.5, circular_segments=32).translate((0, 0, 2.55))
plunger = pl

# ---------------- ghosts ----------------
bt = load_stl(os.environ.get('TDS3_STL', os.path.join(HERE, 't-display-s3-full.stl')))
R = np.array([[0, 1, 0], [1, 0, 0], [0, 0, -1]], float); bb = bt @ R.T; bb[..., 2] -= 6.38
M = board_M(); board_world = bb @ M[:, :3].T + M[:, 3]
def board_parts():
    return [bbox_b(6.66, 56.53, -12.98, 12.98, -5.18, -0.02), bbox_b(0, PCB_L, -12.75, 12.75, -6.38, -5.18),
            bbox_b(USB['x0'], USB['x1'], -3.31, 3.04, -5.18, -2.02), bbox_b(0.5, 4.0, -11.4, -7.2, -5.18, -2.70),
            bbox_b(0.5, 4.0, 6.7, 10.9, -5.18, -2.70), bbox_b(0.5, 60.0, -12.0, 12.0, -9.9, -6.38)]
def board_proxy(): return Manifold.batch_boolean(board_parts(), OpType.Add)
pin_zone = bbox_b(HDR[0] - 1.5, HDR[1] + 1.5, -13.0, 13.0, PCB_BACK - PIN_CLR, PCB_BACK - 0.01)
BY0 = 34.0
ghost_bat = box(-BAT[0] / 2, BAT[0] / 2, BY0, BY0 + BAT[1], T + 0.1, T + BAT[2])
ky040 = fbox(KNOB_X - 21.5, KNOB_X + 10.5, V_KNOB - 9.5, V_KNOB + 9.5, -ENC_PLATE - 6.6 - 1.6 - 2.5, -ENC_PLATE - 6.6) + \
        fbox(KNOB_X - 6, KNOB_X + 6, V_KNOB - 6, V_KNOB + 6, -ENC_PLATE - 6.6, -ENC_PLATE)
switches = Manifold.batch_boolean([fbox(kx - 7, kx + 7, V_KEYS - 7, V_KEYS + 7, -MX_PLATE - 5.0 - 3.3, -MX_PLATE) for kx in (KEY_A_X, KEY_B_X)], OpType.Add)

if __name__ == '__main__':
    for nm, m in (('body', body), ('cover', cover), ('knob', knob), ('plunger', plunger)):
        b = m.bounding_box()
        print(f"{nm:8s} vol={m.volume()/1000:6.1f}cm3 bodies={len(m.decompose())} bbox=({b[0]:.1f},{b[1]:.1f},{b[2]:.1f})..({b[3]:.1f},{b[4]:.1f},{b[5]:.1f})")
    bp = board_proxy(); clipsU = Manifold.batch_boolean(clips, OpType.Add)
    sweep = Manifold.batch_boolean([Manifold.batch_hull([p, p.translate(tuple(-6 * np.array([0, *n])))]) for p in board_parts()], OpType.Add)
    chk = {'body∩board': body ^ bp, 'body∩pin_zone': body ^ pin_zone, 'cover∩body': cover ^ body, 'cover∩pin_zone': cover ^ pin_zone,
           'body∩ky040': body ^ ky040, 'body∩switch': body ^ switches, 'body∩battery': body ^ ghost_bat, 'cover∩battery': cover ^ ghost_bat,
           'battery∩pin_zone': ghost_bat ^ pin_zone, 'battery∩ky040': ghost_bat ^ ky040, 'battery∩switch': ghost_bat ^ switches,
           'insert sweep∩(body-clips)': sweep ^ (body - clipsU), 'cover∩board': cover ^ bp}
    for k, v in chk.items(): print(f"  {k:28s} {v.volume():.3f}")
    bbx = solid.bounding_box()
    print('size W x D x H =', round(bbx[3] - bbx[0], 1), 'x', round(bbx[4] - bbx[1], 1), 'x', round(bbx[5] - bbx[2], 1),
          '| glass centre z', round((V_SCREEN * u)[1], 1), '| F2', F2.round(1), 'F3', F3.round(1))
