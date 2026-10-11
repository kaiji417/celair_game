"""
参加者向けスライド（ルール説明 / 操作説明）を生成する。

  python tools/make-slides.py

出力: docs/CELIAR_ルール説明.pptx, docs/CELIAR_操作説明.pptx
画像: docs/slide-assets/（スマホ画面は tools/phone-shots.cjs で撮り直せる）

デザインはゲーム画面に合わせる: 黒地 / 朱の帯 / 金の数字 / 角の朱L字。
"""
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Pt

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT.parent / "docs"
ASSETS = DOCS / "slide-assets"
LOGO_STACKED = ROOT / "frontend" / "public" / "logo-stacked.png"
LOGO_WIDE = ROOT / "frontend" / "public" / "logo-horizontal.png"

# ---- 色（frontend/src/index.css の値と揃える）----
BG = RGBColor(0x0A, 0x0A, 0x0B)
CARD = RGBColor(0x16, 0x16, 0x19)
CARD2 = RGBColor(0x1E, 0x1E, 0x22)
LINE = RGBColor(0x2E, 0x2E, 0x33)
TEXT = RGBColor(0xF2, 0xEF, 0xE8)
DIM = RGBColor(0x8E, 0x8B, 0x84)
RED = RGBColor(0xC8, 0x10, 0x2E)
GOLD = RGBColor(0xD4, 0xAF, 0x37)
INK = RGBColor(0x11, 0x11, 0x11)

FONT_JA = "Noto Sans JP"
FONT_JA_BOLD = "Noto Sans JP Black"
FONT_NUM = "Bahnschrift SemiBold Condensed"

# 16:9
SW, SH = Emu(12192000), Emu(6858000)


# スライド幅 13.333in = 960pt を 1920px とみなす
PT_PER_PX = 960 / 1920


def px(v: float) -> Emu:
    """1920px幅を基準にした座標系で配置する（画面デザインの寸法感覚のまま書ける）"""
    return Emu(int(v * 12192000 / 1920))


# ---------------------------------------------------------------------------
# 画像の下ごしらえ
# ---------------------------------------------------------------------------
def prepare_assets() -> dict:
    ASSETS.mkdir(parents=True, exist_ok=True)
    out = {}

    # ロゴは黒インクの透過PNG。黒地で読めるよう白へ反転したものを作る
    for key, src in (("logo_stacked", LOGO_STACKED), ("logo_wide", LOGO_WIDE)):
        im = Image.open(src).convert("RGBA")
        r, g, b, a = im.split()
        white = Image.merge("RGBA", (
            Image.new("L", im.size, 0xF2), Image.new("L", im.size, 0xEF), Image.new("L", im.size, 0xE8), a,
        ))
        dst = ASSETS / f"{key}-white.png"
        white.save(dst)
        out[key] = dst

    # 結果通知は画面下半分のシートだけ切り出す（上は暗い背景だけなので）
    res = ASSETS / "phone-6-result.png"
    if res.exists():
        im = Image.open(res)
        w, h = im.size
        crop = im.crop((0, int(h * 0.47), w, h))
        dst = ASSETS / "phone-6-result-sheet.png"
        crop.save(dst)
        out["result_sheet"] = dst
    return out


# ---------------------------------------------------------------------------
# 描画ヘルパー
# ---------------------------------------------------------------------------
def rect(slide, x, y, w, h, fill=None, line=None, line_w=1.0, shape=MSO_SHAPE.RECTANGLE):
    s = slide.shapes.add_shape(shape, px(x), px(y), px(w), px(h))
    s.shadow.inherit = False
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(line_w)
    return s


def text(slide, x, y, w, h, runs, size=28, color=TEXT, font=FONT_JA, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=0, line_spacing=None):
    """runs: 文字列、または [(文字列, {上書き設定}), ...] の段落リスト（段落は '\n' で分割）"""
    tb = slide.shapes.add_textbox(px(x), px(y), px(w), px(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor

    if isinstance(runs, str):
        runs = [(runs, {})]

    # 段落に分ける
    paragraphs = [[]]
    for s, opt in runs:
        parts = s.split("\n")
        for i, part in enumerate(parts):
            if i > 0:
                paragraphs.append([])
            if part:
                paragraphs[-1].append((part, opt))

    for pi, para in enumerate(paragraphs):
        p = tf.paragraphs[0] if pi == 0 else tf.add_paragraph()
        p.alignment = align
        if line_spacing:
            p.line_spacing = line_spacing
        for s, opt in para:
            r = p.add_run()
            r.text = s
            f = r.font
            f.name = opt.get("font", font)
            # 文字サイズも 1920px 基準で指定する（このスライド寸法では 1pt = 2px）
            f.size = Pt(opt.get("size", size) * PT_PER_PX)
            f.bold = opt.get("bold", bold)
            f.color.rgb = opt.get("color", color)
            sp = opt.get("spacing", spacing)
            if sp:
                # 字間（1/100pt単位）。python-pptx に API がないので XML で設定する
                r._r.get_or_add_rPr().set("spc", str(int(sp * PT_PER_PX * 100)))
            # 和文フォントも同じにする（東アジア文字が別フォントで描かれるのを防ぐ）
            rpr = r._r.get_or_add_rPr()
            for tag in ("a:ea", "a:cs"):
                el = rpr.find(tag.replace("a:", "{http://schemas.openxmlformats.org/drawingml/2006/main}"))
                if el is None:
                    el = rpr.makeelement("{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag[2:], {})
                    rpr.append(el)
                el.set("typeface", opt.get("font", font))
    return tb


def corner_marks(slide, x, y, w, h, size=34, thick=5):
    """左上・右下に朱のL字。ゲーム画面の枠と同じ装飾"""
    rect(slide, x, y, size, thick, fill=RED)
    rect(slide, x, y, thick, size, fill=RED)
    rect(slide, x + w - size, y + h - thick, size, thick, fill=RED)
    rect(slide, x + w - thick, y + h - size, thick, size, fill=RED)


def red_band(slide, cx, y, label, size=30, pad_x=48, h=68):
    """朱の帯ラベル（中央揃え）。全角1文字 ≒ 1em ＋ 字間 0.4em で幅を見積もる"""
    width = len(label) * size * 1.4 + pad_x * 2
    x = cx - width / 2
    rect(slide, x, y, width, h, fill=RED)
    # 字間は最後の文字の後ろにも付くので、その分だけ左に余白を足して見た目の中央を揃える
    text(slide, x + size * 0.4, y, width, h, label, size=size, font=FONT_JA_BOLD, color=TEXT,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=size * 0.4)
    return width


def base(prs, page=None, total=None, section=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = BG
    # 上部の朱の細線（画面上部の朱の光に相当）
    rect(slide, 0, 0, 1920, 6, fill=RED)
    if section:
        text(slide, 80, 44, 1000, 40, section, size=22, color=DIM, spacing=5, font=FONT_JA)
    if page:
        text(slide, 1600, 44, 240, 40, f"{page:02d} / {total:02d}", size=24, color=DIM,
             font=FONT_NUM, align=PP_ALIGN.RIGHT, spacing=2)
    return slide


def heading(slide, title, sub=None, y=100):
    text(slide, 80, y, 1760, 110, title, size=84, font=FONT_JA_BOLD, color=TEXT, spacing=4)
    rect(slide, 82, y + 124, 80, 7, fill=RED)
    if sub:
        text(slide, 80, y + 156, 1760, 50, sub, size=30, color=DIM)


def card(slide, x, y, w, h, fill=CARD, marks=False):
    rect(slide, x, y, w, h, fill=fill, line=LINE, line_w=1)
    if marks:
        corner_marks(slide, x, y, w, h)


def phone(slide, img, x, y, h):
    """スマホ画面を黒い縁付きで置く"""
    im = Image.open(img)
    w = h * im.size[0] / im.size[1]
    rect(slide, x - 10, y - 10, w + 20, h + 20, fill=RGBColor(0x00, 0x00, 0x00), line=LINE, line_w=1.5,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE).adjustments[0] = 0.06
    slide.shapes.add_picture(str(img), px(x), px(y), px(w), px(h))
    return w


def num_badge(slide, x, y, n, size=64):
    rect(slide, x, y, size, size, fill=GOLD)
    text(slide, x, y, size, size, str(n), size=size * 0.7, font=FONT_NUM, color=INK,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


# ---------------------------------------------------------------------------
# ルール説明
# ---------------------------------------------------------------------------
def cover(prs, assets, label, tagline):
    s = base(prs)
    lw = 460
    s.shapes.add_picture(str(assets["logo_stacked"]), px(960 - lw / 2), px(150), px(lw))
    red_band(s, 960, 700, label, size=44, h=92, pad_x=60)
    text(s, 0, 840, 1920, 60, tagline, size=34, color=DIM, align=PP_ALIGN.CENTER, spacing=3)
    return s


# ---------------------------------------------------------------------------
# 説明スライド（ゲーム開始前に司会が手短に流す。1本にまとめる）
#
# 当日の流れ: リーダーはスプシで事前に決定 → テーブルのQRをリーダーだけが読み取る
#            → このスライドでルールと操作を説明 → ゲーム開始
# ---------------------------------------------------------------------------
G = {"color": GOLD, "font": FONT_JA_BOLD}


def build_deck(assets) -> Presentation:
    prs = Presentation()
    prs.slide_width, prs.slide_height = SW, SH
    total = 7
    A = ASSETS

    # 1. 表紙
    cover(prs, assets, "ルール説明", "クイズに正解して、ポイントを山分けせよ。")

    # 2. まずリーダーが参加
    s = base(prs, 2, total, "STEP 1  参加")
    text(s, 80, 110, 1100, 110, "リーダーだけ、参加", size=84, font=FONT_JA_BOLD, spacing=3)
    rect(s, 82, 234, 80, 7, fill=RED)
    lines = [
        [("テーブルの ", {}), ("QRコード", G), (" を読み取る", {})],
        [("自分のチーム名", G), ("を選んで\n「参加する」", {})],
    ]
    y = 330
    for i, ln in enumerate(lines):
        num_badge(s, 80, y, i + 1, size=76)
        text(s, 190, y - 4, 1000, 170, ln, size=46, line_spacing=1.3)
        y += 220
    card(s, 80, 800, 1100, 150)
    rect(s, 80, 800, 8, 150, fill=RED)
    text(s, 120, 800, 1040, 150, [("スマホを使うのは、", {}), ("チームのリーダー1人だけ", G), ("。\nほかのメンバーはリーダーの画面を一緒に見てください。", {})],
         size=32, color=DIM, anchor=MSO_ANCHOR.MIDDLE, line_spacing=1.4)
    phone(s, A / "phone-1-join.png", 1400, 100, 880)

    # 3. どんなゲームか（新郎新婦クイズ → 回答 → 正解でポイント）
    s = base(prs, 3, total, "GAME  どんなゲーム？")
    text(s, 0, 120, 1920, 120, [("新郎新婦", G), ("にまつわるクイズ", {})], size=90,
         font=FONT_JA_BOLD, align=PP_ALIGN.CENTER, spacing=3)
    rect(s, 920, 262, 80, 7, fill=RED)
    flow = [
        ("Q", "出題", "ふたりにまつわる\nクイズが出る"),
        ("A", "回答", "チームで相談して\n答えを1つ選ぶ"),
        ("pt", "正解", "正解したチームに\nポイント"),
    ]
    for i, (mark, title, body) in enumerate(flow):
        x = 140 + i * 580
        hot = i == 2
        card(s, x, 340, 480, 500, fill=CARD2 if hot else CARD, marks=hot)
        text(s, x, 380, 480, 190, mark, size=170, font=FONT_NUM, color=GOLD if hot else TEXT,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x, 590, 480, 80, title, size=54, font=FONT_JA_BOLD, align=PP_ALIGN.CENTER,
             color=GOLD if hot else TEXT, spacing=4)
        text(s, x + 20, 690, 440, 130, body, size=34, color=DIM, align=PP_ALIGN.CENTER, line_spacing=1.35)
        if i < len(flow) - 1:
            text(s, x + 480, 540, 100, 100, "›", size=110, color=RED, align=PP_ALIGN.CENTER,
                 anchor=MSO_ANCHOR.MIDDLE, font=FONT_NUM)
    text(s, 80, 900, 1760, 80, [("ふたりのことを、どれだけ知っているか。", {}), ("全問終わって一番ポイントが多いチームが優勝", G)],
         size=38, align=PP_ALIGN.CENTER)

    # 4. ルール
    s = base(prs, 4, total, "RULE  ルール")
    heading(s, "ルールは3つだけ")
    rules = [
        ("0", "pt", "全チーム\n0ポイントから"),
        ("÷", "", "正解したチームで\n山分け"),
        ("±0", "", "外しても\n減点なし"),
    ]
    for i, (big, unit, body) in enumerate(rules):
        x = 80 + i * 600
        # 見出しの下の残りの高さに対して、カードを縦中央に置く
        card(s, x, 330, 560, 620, marks=(i == 1))
        runs = [(big, {})] + ([(" " + unit, {"size": 64, "color": DIM})] if unit else [])
        text(s, x, 390, 560, 280, runs, size=230, font=FONT_NUM, color=GOLD,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 20, 720, 520, 170, body, size=54, font=FONT_JA_BOLD, align=PP_ALIGN.CENTER, line_spacing=1.25)


    # 5. 山分け
    s = base(prs, 5, total, "RULE  ルール")
    heading(s, "正解が少ないほど、大きく稼げる", "例：3,000 pt の問題")
    cases = [
        ("6チーム正解", "+500", False),
        ("2チーム正解", "+1,500", False),
        ("1チームだけ正解", "+3,000", True),
    ]
    for i, (cnt, gain, hot) in enumerate(cases):
        x = 80 + i * 600
        card(s, x, 360, 560, 440, fill=CARD2 if hot else CARD, marks=hot)
        if hot:
            red_band(s, x + 280, 326, "総取り", size=32, h=68)
        text(s, x, 420, 560, 70, cnt, size=48, font=FONT_JA_BOLD, align=PP_ALIGN.CENTER)
        text(s, x, 520, 560, 220, [(gain, {}), (" pt", {"size": 54, "color": DIM})], size=170,
             font=FONT_NUM, color=GOLD, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 80, 870, 1760, 70, [("後半ほど配分が大きい。", {}), ("最後の1問まで逆転できる。", G)],
         size=44, align=PP_ALIGN.CENTER)

    # 6. 操作
    s = base(prs, 6, total, "STEP 2  回答")
    text(s, 80, 110, 900, 110, "回答のしかた", size=84, font=FONT_JA_BOLD, spacing=3)
    rect(s, 82, 234, 80, 7, fill=RED)
    steps = [
        [("選択肢を", {}), ("タップ", G)],
        [("「回答する」", G), ("を押す", {})],
    ]
    y = 330
    for i, ln in enumerate(steps):
        num_badge(s, 80, y, i + 1, size=76)
        text(s, 190, y - 4, 800, 100, ln, size=50)
        y += 150
    text(s, 80, 640, 880, 140, [("締め切りまでは\n", {}), ("何度でも選び直せる", G)], size=44, line_spacing=1.3)
    card(s, 80, 830, 840, 120)
    rect(s, 80, 830, 8, 120, fill=RED)
    text(s, 120, 830, 780, 120, "正解発表は会場の画面で。\nスマホにはそのあと結果が届きます。",
         size=30, color=DIM, anchor=MSO_ANCHOR.MIDDLE, line_spacing=1.4)
    # 選んだ状態 → 送信した状態
    im = Image.open(A / "phone-3-select.png")
    h = 820
    w = h * im.size[0] / im.size[1]
    x2 = 1840 - w
    x1 = x2 - 56 - w
    phone(s, A / "phone-3-select.png", x1, 110, h)
    phone(s, A / "phone-4-answered.png", x2, 110, h)
    text(s, x1, 960, w, 40, "① 選ぶ", size=28, color=DIM, align=PP_ALIGN.CENTER)
    text(s, x2, 960, w, 40, "② 送信できた", size=28, color=GOLD, align=PP_ALIGN.CENTER)

    # 7. 開始
    s = base(prs, 7, total)
    s.shapes.add_picture(str(assets["logo_wide"]), px(960 - 450), px(250), px(900))
    text(s, 0, 450, 1920, 140, "ゲーム開始", size=120, font=FONT_JA_BOLD, align=PP_ALIGN.CENTER, spacing=12)
    rect(s, 920, 640, 80, 7, fill=RED)
    text(s, 0, 700, 1920, 120, "困ったときは、運営スタッフに声をかけてください",
         size=36, color=DIM, align=PP_ALIGN.CENTER)
    return prs


def main():
    assets = prepare_assets()
    DOCS.mkdir(exist_ok=True)
    out = DOCS / "CELIAR_ルール説明.pptx"
    build_deck(assets).save(out)
    print(out)


if __name__ == "__main__":
    main()
