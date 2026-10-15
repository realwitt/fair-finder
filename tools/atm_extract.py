# Locate ATM ($) icons on the official map tiles. Run tools/atm_stitch.py first (writes stitch.png at level 17).
# Template = the ATM icon cropped from level-17 tile 17/51562/36878 at x162,y229 (44x45 px). Score >= 0.6 + NMS.
# Pixel -> Web Mercator -> WGS84 using origin tile (36874, 51560), 512px tiles, res = 2*pi*R/512/2**17.
