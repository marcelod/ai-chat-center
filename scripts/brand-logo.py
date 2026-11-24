import math, sys
# Generates assets/brand/logo.svg (the AI Chat Center emblem, transparent background), traced from
# assets/brand/logo-original.png. Usage: python3 scripts/brand-logo.py assets/brand/logo.svg
out = sys.argv[1]
CX, CY = 752, 433
# outer ring colour by angle (deg, screen coords), sampled from the PNG
T = [(-33,(110,16,250)),(-50,(99,18,250)),(-70,(57,95,252)),(-90,(16,160,253)),(-110,(0,208,254)),(-130,(0,240,253)),
     (-150,(0,234,254)),(-170,(0,215,254)),(-190,(0,193,254)),(-210,(2,149,254)),(-230,(27,99,253)),(-250,(47,47,251)),
     (-270,(54,30,250)),(-290,(67,30,251)),(-310,(122,31,252)),(-327,(215,76,250))]
def col(a):
    for (a0,c0),(a1,c1) in zip(T,T[1:]):
        if a1 <= a <= a0:
            t=(a-a0)/(a1-a0); return tuple(round(c0[i]+(c1[i]-c0[i])*t) for i in range(3))
    return T[0][1] if a > T[0][0] else T[-1][1]
def pt(r,a,cx=CX,cy=CY):
    return cx+r*math.cos(math.radians(a)), cy+r*math.sin(math.radians(a))
def ring(cx,cy,ro,ri,a0,a1):
    # a0 -> a1 going counter-clockwise on screen (decreasing angle), outer arc then inner arc back
    x0,y0=pt(ro,a0,cx,cy); x1,y1=pt(ro,a1,cx,cy); x2,y2=pt(ri,a1,cx,cy); x3,y3=pt(ri,a0,cx,cy)
    large = 1 if abs(a0-a1) > 180 else 0
    return f"M{x0:.1f} {y0:.1f}A{ro} {ro} 0 {large} 0 {x1:.1f} {y1:.1f}L{x2:.1f} {y2:.1f}A{ri} {ri} 0 {large} 1 {x3:.1f} {y3:.1f}Z"
J = 14  # rounded corners: the shape is shrunk by J/2 and stroked with J, round joins
wedges=[]
step=1.5
for a in [ -33 - i*step for i in range(int(295/step)+1) ]:
    c=col(a-step/2)
    p1=pt(420,a+0.6); p2=pt(420,a-step-0.6)
    wedges.append(f'<path d="M{CX} {CY}L{p1[0]:.1f} {p1[1]:.1f}L{p2[0]:.1f} {p2[1]:.1f}Z" fill="#{c[0]:02x}{c[1]:02x}{c[2]:02x}"/>')
outer = ring(CX,CY,323-J/2,244+J/2,-33,-327)
ICX, ICY = 760, 438
inner = ring(ICX,ICY,216-J/2,154+J/2,-47,-313)
bubble = "M702 526A105 108.5 0 0 1 657 437.5A105 108.5 0 0 1 762 329H843A105 108.5 0 0 1 948 437.5A105 108.5 0 0 1 843 546H752L690 580Z"
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="399 100 666 666" width="666" height="666">
  <title>AI Chat Center</title>
  <defs>
    <mask id="outer-mask" maskUnits="userSpaceOnUse" x="399" y="100" width="666" height="666">
      <path d="{outer}" fill="#fff" stroke="#fff" stroke-width="{J}" stroke-linejoin="round"/>
    </mask>
    <mask id="inner-mask" maskUnits="userSpaceOnUse" x="399" y="100" width="666" height="666">
      <path d="{inner}" fill="#fff" stroke="#fff" stroke-width="{J}" stroke-linejoin="round"/>
      <path d="{bubble}" fill="#000" stroke="#000" stroke-width="44" stroke-linejoin="round"/>
    </mask>
    <linearGradient id="inner-fill" gradientUnits="userSpaceOnUse" x1="0" y1="222" x2="0" y2="654">
      <stop offset="0" stop-color="#F7F9FD"/><stop offset=".55" stop-color="#E4EDF9"/><stop offset="1" stop-color="#CBD8F0"/>
    </linearGradient>
    <linearGradient id="bubble-stroke" gradientUnits="userSpaceOnUse" x1="650" y1="380" x2="955" y2="500">
      <stop offset="0" stop-color="#00E6FD"/><stop offset=".45" stop-color="#05B8FE"/><stop offset=".75" stop-color="#3A6BFE"/><stop offset="1" stop-color="#7A18FE"/>
    </linearGradient>
    <linearGradient id="dots" gradientUnits="userSpaceOnUse" x1="752" y1="0" x2="849" y2="0">
      <stop offset="0" stop-color="#0BCBF5"/><stop offset="1" stop-color="#0098FE"/>
    </linearGradient>
  </defs>
  <g id="outer-c" mask="url(#outer-mask)">
    {"".join(wedges)}
  </g>
  <rect id="inner-c" x="399" y="100" width="666" height="666" fill="url(#inner-fill)" mask="url(#inner-mask)"/>
  <path id="bubble" d="{bubble}" fill="#060A2E" stroke="url(#bubble-stroke)" stroke-width="20" stroke-linejoin="round"/>
  <g id="ai" fill="#fff">
    <path d="M722 470L769.5 372H794.5L842 470H815.5L805.5 448H758.5L748.5 470ZM766.5 427H797.5L782 392Z"/>
    <rect x="853" y="372" width="24.5" height="98"/>
  </g>
  <g id="chat-dots" fill="url(#dots)">
    <circle cx="763.5" cy="500" r="10.5"/><circle cx="800.5" cy="500" r="10.5"/><circle cx="837.5" cy="500" r="10.5"/>
  </g>
</svg>
'''
open(out,'w').write(svg)
