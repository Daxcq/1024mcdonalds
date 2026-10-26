"""Cut icons out of the reference sheets, strip the background, save PNG sprites + ghost versions."""
import json, os, sys
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'sprites')
os.makedirs(OUT, exist_ok=True)

def load_boxes(path): return json.load(open(path))

MENU = {2:'burger',3:'cheeseburger',0:'double_cheese',4:'mcchicken',5:'spicy_mcchicken',1:'bigmac',
        9:'spicy_leg',10:'crispy_chicken',11:'teriyaki',12:'fries_s',8:'fries_m',13:'fries_l',
        20:'nuggets5',21:'nuggets10',22:'fried_chicken',23:'spicy_wings',24:'wings2',25:'apple_pie',
        35:'mcflurry',31:'cone',36:'sundae',32:'iced_coffee',37:'hot_coffee',33:'cola',34:'orange'}
MENU_ROWS = [(0,235),(300,494),(540,720),(760,952)]   # (row_top, label_top) clip lines

PARTS = {1:'bun_top',4:'bun_bottom',5:'patty_beef',6:'patty_chicken',7:'cheese',2:'lettuce',3:'tomato',
         8:'pickle',9:'onion',10:'sauce_ketchup',11:'sauce_mustard',12:'sauce_mayo',
         35:'fries_pack',36:'hashbrown',37:'nugget',38:'nuggets_pile5',39:'nuggets_pile10',
         52:'drumstick',53:'nugget_platter',55:'tenders',56:'wrap',
         65:'cola_s',66:'cola_m',67:'cola_l',68:'sprite_s',69:'sprite_m',70:'sprite_l',
         71:'fanta_s',72:'fanta_m',73:'fanta_l',74:'icetea_s',75:'icetea_m',76:'icetea_l',
         77:'cone_vanilla',78:'cone_choc',79:'sundae_straw',80:'sundae_choc',81:'mcflurry_p',
         83:'coffee_s',84:'coffee_m',85:'coffee_l',86:'icedcoffee_p',87:'shake_van',88:'shake_straw',89:'shake_choc',
         91:'box_burger',92:'box_nuggets',93:'box_fries',94:'box_wings',95:'cup_s',96:'cup_m',97:'cup_l',
         98:'straw1',99:'straw2',100:'tray',101:'bag_paper',102:'bag_takeaway',103:'napkin',
         104:'packet_ketchup',105:'packet_mustard',106:'sugar'}
# bottom clip lines for the parts sheet (label text sits below these)
def parts_clip(y_top):
    bands=[(0,150,148),(150,350,316),(350,520,478),(520,660,622),(660,800,772),(800,910,889),(910,1100,994)]
    for a,b,c in bands:
        if a<=y_top<b: return c
    return None

def remove_bg(crop):
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    cand = ((hsv[...,2] > 195) & (hsv[...,1] < 70)).astype(np.uint8)
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    border = set(lab[0,:])|set(lab[-1,:])|set(lab[:,0])|set(lab[:,-1])
    bg = np.isin(lab, [l for l in border if l!=0]) & (cand>0)
    alpha = (~bg).astype(np.uint8)*255
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((2,2),np.uint8))
    # keep biggest component(s) only
    n, lab, st, _ = cv2.connectedComponentsWithStats((alpha>0).astype(np.uint8), connectivity=8)
    if n>1:
        keep = [i for i in range(1,n) if st[i,4] >= 0.02*st[1:,4].max()]
        alpha = np.where(np.isin(lab, keep), 255, 0).astype(np.uint8)
    alpha = cv2.erode(alpha, np.ones((2,2),np.uint8))
    return alpha

def save(crop, key, manifest):
    alpha = remove_bg(crop)
    ys, xs = np.where(alpha>0)
    if len(xs)==0: print('EMPTY', key); return
    x0,x1,y0,y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    rgba = np.dstack([crop, alpha])[y0:y1, x0:x1]
    cv2.imwrite(os.path.join(OUT, key+'.png'), rgba)
    # ghost: grayscale, lightened, translucent -> "empty container" look
    g = cv2.cvtColor(rgba[...,:3], cv2.COLOR_BGR2GRAY)
    g = (g*0.5+120).clip(0,255).astype(np.uint8)
    ghost = np.dstack([g,g,g,(rgba[...,3]*0.55).astype(np.uint8)])
    cv2.imwrite(os.path.join(OUT, key+'_ghost.png'), ghost)
    manifest[key] = {'w': int(x1-x0), 'h': int(y1-y0)}

manifest = {}
im = cv2.imread(os.path.join(ROOT,'assets','menu_icons.jpg'))
boxes = load_boxes(sys.argv[1])
for idx,key in MENU.items():
    x,y,w,h = boxes[idx]
    clip = next(c for (a,c) in MENU_ROWS if y >= a - 40 and y < c) if False else None
    for top,c in MENU_ROWS:
        if y >= top-40 and y < c: clip = c
    y2 = min(y+h, clip)
    save(im[y:y2, x:x+w], key, manifest)

im = cv2.imread(os.path.join(ROOT,'assets','parts_sheet.jpg'))
boxes = load_boxes(sys.argv[2])
for idx,key in PARTS.items():
    x,y,w,h = boxes[idx]
    c = parts_clip(y)
    y2 = min(y+h, c) if c else y+h
    save(im[y:y2, x:x+w], key, manifest)

json.dump(manifest, open(os.path.join(ROOT,'assets','sprites.json'),'w'), indent=1)
print(len(manifest),'sprites')
