# 퀀트 오피스 로고: 네모 배경 + 픽셀 대문자 Q (16x16 격자)
from PIL import Image
G = [
"................",
"................",
".....######.....",
"....########....",
"...###....###...",
"...##......##...",
"...##......##...",
"...##......##...",
"...##...#..##...",
"...##...##.##...",
"...###...####...",
"....########....",
".....########...",
"...........###..",
"................",
"................",
]
BG = (20, 21, 23)       # 앱 배경과 같은 먹색
EDGE = (58, 61, 68)     # 테두리
Q = (255, 201, 74)      # 앱 강조색 (amber)
SH = (196, 140, 30)     # Q 그림자
TAIL = (89, 227, 196)   # 꼬리: 민트 (상승 화살표 느낌)
N = 16
# 바깥 빈 칸 찾기 (Q 구멍 안쪽은 그림자 없음)
outside = set()
stack = [(0, 0)]
while stack:
    r, c = stack.pop()
    if (r, c) in outside or not (0 <= r < N and 0 <= c < N) or G[r][c] == '#':
        continue
    outside.add((r, c))
    stack += [(r+1, c), (r-1, c), (r, c+1), (r, c-1)]
def cell(r, c):
    ch = G[r][c]
    if ch == '#':
        return Q
    # 그림자: 바깥쪽 빈 칸 중 왼쪽 위 대각선에 Q가 있는 칸
    if (r, c) in outside and r > 0 and c > 0 and G[r-1][c-1] == '#' and 0 < r < N-1 and 0 < c < N-1:
        return SH
    if r in (0, N-1) or c in (0, N-1):
        return EDGE
    return BG
def render(size, path, pad=False):
    img = Image.new('RGB', (N, N))
    for r in range(N):
        for c in range(N):
            img.putpixel((c, r), cell(r, c))
    img = img.resize((size, size), Image.NEAREST)
    img.save(path)
for s in (16, 32, 64, 180, 192, 512, 1024):
    render(s, f'logo-{s}.png')
# SVG (선명한 픽셀)
rects = []
for r in range(N):
    for c in range(N):
        col = '#%02x%02x%02x' % cell(r, c)
        rects.append(f'<rect x="{c}" y="{r}" width="1" height="1" fill="{col}"/>')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" width="512" height="512" shape-rendering="crispEdges">' + ''.join(rects) + '</svg>'
open('logo.svg', 'w').write(svg)
# 파비콘 .ico (16·32·64)
Image.open('logo-64.png').save('favicon.ico', sizes=[(16, 16), (32, 32), (64, 64)])
print('ok')
