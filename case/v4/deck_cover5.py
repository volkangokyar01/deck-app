# Volkan Deck — back cover v5 (fits the unchanged v4 body)
# Why: the v4 cover's 4 hooks had their catch right at the root (7 mm beam, catch at 0-3 mm), so pushing the
# cover in needed ~4 % strain across the layer lines -> PLA hooks snapped and the cover was hard to seat.
# v5:
#   * bottom edge: 2 rigid tabs that slide behind the wall (tilt the cover in, no flexing)
#   * top edge:    2 spring arms cut into the cover, flexing IN THE PLANE of the plate (= along the layers when
#                  printed flat) -> ~0.7 % strain in PLA; 30 deg lead-in, 60 deg retention face
#   * 0.8 mm outer rim on the top and sides: stops the cover from going in too far and hides the gap
#   * 0.35 mm clearance around the plug (was 0.2)
# Coordinates: back frame (x, w = up the back from its bottom edge, m = outward normal; wall = -T..0).
# Printed outer face down, no supports.
import os, sys, io, contextlib, math, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case4 as D
from manifold3d import Manifold, CrossSection, JoinType, OpType

T, OW, OH, OR, OW0 = D.T, D.OW, D.OH, D.OR, D.OW0
W_TOP = OW0 + OH                      # opening top edge (w)
# ---------------- parameters (mm) ----------------
CLR    = 0.35    # plug clearance per side
RIM_T  = 0.8     # outer rim thickness
RIM_O  = 1.5     # rim overlap over the back surface (top + sides)
TAB_X  = (14.0, 30.0)   # bottom tabs |x| range
TAB_OV = 2.2     # how far the tabs reach behind the wall below the opening
TAB_T  = 1.4     # tab thickness
TAB_G  = 0.25    # gap between tab and the wall's inner face
ARM_ROOT = 4.0   # spring arms: root block |x| < ARM_ROOT
ARM_END  = 27.0  # arm free end |x|
ARM_T  = 1.6     # arm thickness (w)
SLOT   = 0.6     # slot around the arm
LIP_O  = 0.7     # lip overlap behind the wall
LIP_X  = 8.0     # lip length along x (at the free end)
LIP_G  = 0.15    # gap between lip and the wall's inner face
LIP_R  = 0.6     # retention face height (m) -> 60 deg face
LIP_D  = 2.7     # lip depth behind the wall (m), lead-in ramp is the rest

def bp(cs, m0, m1): return D.back_prism(cs, m0, m1)
def rect(x0, x1, w0, w1): return CrossSection.square((x1 - x0, w1 - w0)).translate((x0, w0))

o_cs   = D.o_cs                                     # opening outline (x, w)
plug_cs = o_cs.offset(-CLR, JoinType.Round, circular_segments=48)
w_plug_top = W_TOP - CLR

# outer rim: opening + RIM_O, only above the opening's bottom edge (the cover rocks on that edge when fitted)
rim_cs = D.rrect(OW + 2 * RIM_O, OH + 2 * RIM_O, OR + RIM_O, 0, OW0 + OH / 2) ^ rect(-60, 60, OW0 + 0.6, 80)
rim_cs = (rim_cs + plug_cs)
# rim with a 0.5 mm chamfer on its outer (bed) edge
rim = Manifold.batch_hull([bp(rim_cs, 0, RIM_T - 0.5), bp(rim_cs.offset(-0.5, JoinType.Round), RIM_T - 0.5, RIM_T)])
cover = bp(plug_cs, -T, 0.01) + rim

# ---- bottom tabs (rigid) ----
tabs = []
for s in (1, -1):
    x0, x1 = sorted((s * TAB_X[0], s * TAB_X[1]))
    w_edge = OW0 + CLR
    tabs.append(bp(rect(x0, x1, OW0 - TAB_OV, w_edge + 3.0), -T - TAB_G - TAB_T, -T - TAB_G))   # plate behind the wall
    tabs.append(bp(rect(x0, x1, w_edge, w_edge + 3.0), -T - TAB_G - TAB_T, -T + 0.01))            # web to the plug
cover += Manifold.batch_boolean(tabs, OpType.Add)

# ---- top spring arms ----
w_arm1 = w_plug_top                 # arm outer face = plug edge
w_arm0 = w_arm1 - ARM_T
# cut the slot: along the arm (below it) and across its free end, through plug + rim
cuts = []
for s in (1, -1):
    xa, xb = sorted((s * ARM_ROOT, s * (ARM_END + SLOT)))
    cuts.append(bp(rect(xa, xb, w_arm0 - SLOT, w_arm0), -T - 5, RIM_T + 1))                  # slot under the arm
    xe0, xe1 = sorted((s * ARM_END, s * (ARM_END + SLOT)))
    cuts.append(bp(rect(xe0, xe1, w_arm0 - SLOT, 80), -T - 5, RIM_T + 1))                     # slot at the free end
cover -= Manifold.batch_boolean(cuts, OpType.Add)
# lips at the arm ends: profile in (w, m) extruded along x
def lip(s):
    m0 = -T - LIP_G
    prof = [(w_arm0, m0 + 0.01), (w_arm1, m0 + 0.01), (W_TOP + LIP_O, m0 - LIP_R), (W_TOP + LIP_O, m0 - LIP_R - 0.4),
            (w_arm1, m0 - LIP_D), (w_arm0, m0 - LIP_D)]
    xa, xb = sorted((s * (ARM_END - LIP_X), s * ARM_END))
    cs = D.poly_cs([(w, m) for w, m in prof])
    # extrude along x: local (w, m, x) -> back frame (x, m, w)
    mm = cs.extrude(xb - xa).transform(np.array([[0, 0, 1, xa], [0, 1, 0, 0], [1, 0, 0, 0]], float))
    return D.on_back(mm)
# arm body behind the plug must stay free of the plug except at the root: the plug itself forms the arm (slot cut),
# plus the arm continues behind the wall line to carry the lip
arms = [bp(rect(*sorted((s * ARM_ROOT, s * ARM_END)), w_arm0, w_arm1), -T - LIP_G - LIP_D, -T + 0.01) for s in (1, -1)]
cover += Manifold.batch_boolean(arms + [lip(1), lip(-1)], OpType.Add)

# ---------------- checks ----------------
def strain(t, d, L): return 1.5 * t * d / L ** 2
def deflection(): return (W_TOP + LIP_O) - w_arm1   # how far the arm must move in while passing the edge

if __name__ == '__main__':
    print('cover bodies', len(cover.decompose()), 'vol cm3', round(cover.volume() / 1000, 2))
    L = (ARM_END - LIP_X / 2) - ARM_ROOT
    print(f'arm: L={L:.1f} t={ARM_T} deflection={deflection():.2f} -> strain {strain(ARM_T, deflection(), L)*100:.2f} %')
    ghosts = {'body': D.body, 'battery': D.ghost_bat, 'board': D.board_proxy(), 'pin_zone': D.pin_zone, 'ky040': D.ky040, 'switch': D.switches}
    for k, g in ghosts.items(): print(f'  cover∩{k:9s} {(cover ^ g).volume():.4f}')
    # fitting motion: tilt about the opening's outer bottom edge (m=0, w=OW0), top swung out by theta
    piv = np.array([0.0, OW0])     # (m, w)
    def rot_about_edge(m, th):
        c, s_ = math.cos(th), math.sin(th)
        # rotation about the x axis through the pivot, in back-frame local coords (x, m, w)
        R = np.array([[1, 0, 0], [0, c, s_], [0, -s_, c]], float)
        t = np.array([0, piv[0], piv[1]]) - R @ np.array([0, piv[0], piv[1]])
        Mloc = np.hstack([R, t[:, None]])
        Bm = D.back_M(); B = np.vstack([Bm, [0, 0, 0, 1]]); Bi = np.linalg.inv(B)
        Mw = B @ np.vstack([Mloc, [0, 0, 0, 1]]) @ Bi
        return m.transform(Mw[:3])
    lower = cover ^ bp(rect(-60, 60, -10, OW0 + 12), -40, 10)       # lower part (tabs) only: the top arms flex anyway
    worst = 0
    for deg in range(0, 46, 3):
        v = (rot_about_edge(lower, math.radians(deg)) ^ D.body).volume(); worst = max(worst, v)
        if v > 0.01: print(f'  tilt {deg:2d} deg: tab/plug ∩ body {v:.3f} mm3')
    print('  fitting sweep (lower half) worst overlap', round(worst, 4))
