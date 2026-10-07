# Volkan Deck — enclosure v6: the v4 body with a new screen holder (no snap clips, no screws)
#
# Why: v4 held the T-Display-S3 with 4 thin snap clips standing on the face. Printed face-down they were
# 1.2 mm beams loaded across the layer lines; they snapped, and pressing the board's own keys (which pushes
# the board away from the face) popped the screen out.
#
# v6:
#   * 4 rigid posts beside the board corners (also centre the board sideways, 0.12 mm per side)
#   * 2 separate clamp bars ("baski cubugu", printed flat) lie across the board ends, behind the PCB, and
#     press it against the face. The left bar presses right behind key B and on both corner margins; the
#     right bar presses along the whole (component-free) right end.
#   * each bar end is locked in its post by a pin cut from 1.75 mm filament (no screws). Pins go in from the
#     board-centre side and stop in a blind hole. The bar hole sits 0.1 mm further back than the pin, so the
#     bar is preloaded against the board.
#   * USB-C: plain rounded-rectangle opening and tunnel (was 14 x 9 with a 45 deg peak), closed all the way
#     to the socket so the inside of the case can't be seen; a notch under the tunnel for the battery plug
#     (it plugs into the JST socket from the board's end).
#   * feet: recesses for 15 mm round self-adhesive pads (were 10 mm), moved slightly inward.
# Everything outside is unchanged: the v5 back cover, knob and key plungers still fit.
# Board frame (from v4): x along the board (0 = USB end), y across, z = face normal (0 = glass front on the
# face's inner surface, PCB back at -6.38, more negative = deeper into the case).
import os, sys, io, contextlib, math, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); V4 = os.path.join(HERE, '..', 'v4')
sys.path.insert(0, V4)
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case4 as D
from manifold3d import Manifold, CrossSection, OpType

PCB_BACK = D.PCB_BACK                 # -6.38
# ---------------- parameters (mm) ----------------
USB_W, USB_H, USB_R = 12.4, 7.2, 1.2   # USB-C opening (plug overmold up to ~12 x 7)
FOOT_D, FOOT_DEPTH = 15.6, 1.0         # 15 mm pads + 0.3 per side
FEET = [(sx * 37.0, fy) for sx in (1, -1) for fy in (15.0, 72.6)]
POST_Y   = (13.10, 17.90)   # |y| of the posts (board edge at 12.98)
PRONG    = 3.0              # prong thickness along x
SLOT_C   = 0.15             # bar-to-prong clearance per side (x)
FLOOR_Z  = -6.0             # slot floor (bar never sits on it, the PCB carries the bar)
PIN_D    = 1.75             # filament
PIN_HOLE = 1.95             # in the posts: snug once printed (horizontal holes come out ~0.1 smaller)
BAR_HOLE = 2.20             # in the bars: loose, for alignment
PIN_Z    = -8.80            # pin axis
PIN_Y    = 15.50            # |y| of the pin axis
PRELOAD  = 0.10             # pin pushes the bar this much toward the face (bar flexes) -> no play
BLIND    = 0.8              # outer prong: hole stops this short of its outer face
POST_TOP = -14.8            # post top (deepest point)
BAR_Y    = 17.70            # bar half length
# bars (board x ranges)
LBAR, RBAR = (0.5, 4.5), (55.5, 60.5)
L_TOP, R_TOP = -13.3, -11.0   # bar back faces
L_BRIDGE = -10.5              # left bar: underside of the raised middle (USB-C top -9.88, JST top -9.18)

bb = D.bbox_b
def U(lst): return Manifold.batch_boolean(lst, OpType.Add)

def _drop(d):
    """Round hole with a 45 deg roof cut flat at the circle (no extra play on the roof side).
    (y, z) offsets, roof toward -z."""
    r = d / 2
    pts = [(r * math.cos(t), r * math.sin(t)) for t in np.linspace(math.radians(-45), math.radians(225), 40)]
    k = r * (math.sqrt(2) - 1)
    return pts + [(-k, -r), (k, -r)]
def teardrop_x(yc, zc, d, x0, x1):
    """Hole along board x, roof toward -z (= up when the body is printed face-down)."""
    return D.prism_b([(yc + a, zc + b) for a, b in _drop(d)], x0, x1)
def teardrop_x_up(yc, zc, d, x0, x1):
    """Same, roof toward +z (= up when a bar is printed back-face-down)."""
    return D.prism_b([(yc + a, zc - b) for a, b in _drop(d)], x0, x1)

# ---------------- body ----------------
clipsU = U(D.clips)
body = D.body - (clipsU ^ bb(-80, 80, -40, 40, -40, 0.0))      # v4 clips gone, face untouched
posts, pin_holes = [], []
def post_pair(bar, outer_left):
    xa, xb = bar
    s0, s1 = xa - SLOT_C, xb + SLOT_C                          # slot
    p0, p1 = s0 - PRONG, s1 + PRONG                            # prongs
    out = []
    for s in (1, -1):
        y0, y1 = sorted((s * POST_Y[0], s * POST_Y[1]))
        blk = bb(p0, p1, y0, y1, POST_TOP, 0.5)                 # 0.5 into the face wall
        blk -= bb(s0, s1, y0 - 1, y1 + 1, POST_TOP - 1, FLOOR_Z)
        out.append(blk)
        # pin: enters from the board-centre side, blind in the outer prong
        if outer_left:   # left pair: outer prong is at x < s0, pin enters from x = p1
            pin_holes.append(teardrop_x(s * PIN_Y, PIN_Z, PIN_HOLE, p0 + BLIND, p1 + 1))
        else:            # right pair: outer prong at x > s1, pin enters from x = p0
            pin_holes.append(teardrop_x(s * PIN_Y, PIN_Z, PIN_HOLE, p0 - 1, p1 - BLIND))
    return out
posts = post_pair(LBAR, True) + post_pair(RBAR, False)
body = body + U(posts) - U(pin_holes)
body = max(body.decompose(), key=lambda m: m.volume())      # drop a zero-volume sliver left by the clip cut
# ---- USB-C: refill the v4 hole / duct (peaked) and cut a plain rounded rectangle, closed up to the socket
from manifold3d import JoinType
x_out = -D.W / 2 - 2 - D.X_B0                                     # beyond the outer wall (board x)
old_duct = D.prism_b(list(map(tuple, D.duct_cs.to_polygons()[0])), x_out, D.duct_end) ^ D.solid
body += old_duct
yc, zc = D.USB['yc'], D.USB['zc']
usb_cs = CrossSection.square((USB_W - 2 * USB_R, USB_H - 2 * USB_R), center=True).offset(USB_R, JoinType.Round, circular_segments=24).translate((yc, zc))
body -= D.prism_b(list(map(tuple, usb_cs.to_polygons()[0])), x_out - 1, D.duct_end + 0.01)
# battery plug notch under the tunnel (JST socket opens toward the board end)
body -= bb(-6.0, 0.4, 5.2, 12.1, -9.6, zc - USB_H / 2) + bb(-6.0, 0.4, 5.2, 12.1, -9.6, -6.6)
# ---- feet: 15 mm pads
for fx, fy in [(sx * (D.W / 2 - 12), fy) for sx in (1, -1) for fy in (14.0, D.F3[0] - 12.0)]:
    body += Manifold.cylinder(1.0, 5.2, circular_segments=48).translate((fx, fy, -0.01)) ^ D.solid   # fill the v4 10 mm recesses
for fx, fy in FEET:
    body -= Manifold.cylinder(FOOT_DEPTH + 0.01, FOOT_D / 2, circular_segments=96).translate((fx, fy, -0.01))

# ---------------- clamp bars (board frame, in place) ----------------
def bar_holes(bar):
    xa, xb = bar
    zc = PIN_Z - (BAR_HOLE - PIN_D) / 2 - PRELOAD                 # hole's face-side edge 0.1 deeper than the pin's
    return U([teardrop_x_up(s * PIN_Y, zc, BAR_HOLE, xa - 1, xb + 1) for s in (1, -1)])
# right: plain bar, flat on the component-free right end of the PCB
rbar = bb(RBAR[0], RBAR[1], -BAR_Y, BAR_Y, R_TOP, PCB_BACK) - bar_holes(RBAR)
# left: raised bridge over USB-C / JST, legs on the two corner margins, a pad right behind key B
xa, xb = LBAR
lbar = bb(xa, xb, -BAR_Y, BAR_Y, L_TOP, L_BRIDGE)
for s in (1, -1):
    y0, y1 = sorted((s * 11.95, s * BAR_Y))
    lbar += bb(xa, xb, y0, y1, L_TOP, PCB_BACK)                 # corner leg + end block
lbar += bb(2.6, 3.9, -11.95, -6.0, L_BRIDGE - 0.01, PCB_BACK)   # behind key B (back of the board is bare here)
lbar -= bar_holes(LBAR)

# ---------------- printed pins (alternative to cut filament) ----------------
# Printed lying flat (layers along the pin -> strong). Octagon 1.7 x 1.2 mm fits the 1.95 mm holes;
# a 3 x 3 mm head stops it at the inner prong and gives something to pull on.
PIN_L = 9.4                       # through the inner prong + slot into the blind outer hole
def printed_pin():
    # octagonal shaft (fits the 1.95 mm hole: 1.7 wide, 1.2 high, 45 deg corners), flat on the bed
    def slab(w, z0, z1):
        return Manifold.cube((PIN_L - 0.4, w, z1 - z0)).translate((0, -w / 2, z0))
    shaft = Manifold.batch_hull([slab(1.1, 0, 0.01), slab(1.7, 0.3, 0.9), slab(1.1, 1.19, 1.2)])
    tip = Manifold.batch_hull([slab(1.1, 0, 0.01).translate((0.4, 0, 0)), slab(1.7, 0.3, 0.9).translate((0.0, 0, 0)), slab(1.1, 1.19, 1.2).translate((0.4, 0, 0))])
    head = Manifold.cube((1.6, 3.0, 1.2)).translate((-1.6, -1.5, 0))
    return shaft + tip + head
pin_part = printed_pin()

# ---------------- ghosts / checks ----------------
board = D.board_proxy()
jst = bb(0.22, 4.92, 5.33, 11.65, -9.18, -6.88)                 # battery socket (from the board STL)
jst_plug = bb(-4.0, 0.22, 5.5, 11.5, -9.0, -7.0)                # plug + cable start
pins = U([D.prism_b([(s * PIN_Y + PIN_D / 2 * math.cos(t), PIN_Z + PIN_D / 2 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 24, endpoint=False)], x0, x1)
          for s in (1, -1) for (x0, x1) in ((LBAR[0] - SLOT_C - PRONG + BLIND, LBAR[1] + SLOT_C + PRONG + 0.5),
                                            (RBAR[0] - SLOT_C - PRONG - 0.5, RBAR[1] + SLOT_C + PRONG - BLIND))])

if __name__ == '__main__':
    import stlio
    from stlio import load_stl
    for nm, m in (('body', body), ('lbar', lbar), ('rbar', rbar)):
        b = m.bounding_box()
        print(f"{nm:6s} vol={m.volume()/1000:6.2f}cm3 bodies={len(m.decompose())} ext=({b[3]-b[0]:.1f},{b[4]-b[1]:.1f},{b[5]-b[2]:.1f})")
    # real board mesh as a Manifold for exact clearance checks
    tri = D.bt
    sweep = U([Manifold.batch_hull([p, p.translate(tuple(-14 * np.array([0, *D.n])))]) for p in D.board_parts()])
    bars = lbar + rbar
    chk = {
        'body ∩ board': body ^ board, 'body ∩ pin_zone': body ^ D.pin_zone, 'board insert sweep ∩ body': sweep ^ body,
        'bars ∩ board(proxy)': bars ^ board, 'bars ∩ body': bars ^ body, 'bars ∩ pin_zone': bars ^ D.pin_zone,
        'bars ∩ jst': bars ^ jst, 'bars ∩ jst plug': bars ^ jst_plug, 'body ∩ jst plug': body ^ jst_plug,
        'body ∩ battery': body ^ D.ghost_bat, 'bars ∩ battery': bars ^ D.ghost_bat, 'body ∩ ky040': body ^ D.ky040,
        'body ∩ switches': body ^ D.switches,
        'USB plug 12x6.8 sweep ∩ body': body ^ D.prism_b(list(map(tuple, CrossSection.square((9.0, 3.8), center=True).offset(1.5, JoinType.Round, circular_segments=24).translate((yc, zc)).to_polygons()[0])), -25, -1.6),
        'feet recess ∩ inner': U([Manifold.cylinder(FOOT_DEPTH + 0.5, FOOT_D / 2 + 0.5).translate((fx, fy, 0)) for fx, fy in FEET]) ^ D.inner,
    }
    for k, v in chk.items(): print(f"  {k:28s} {v.volume():.3f}")
