# TraceEffect

暗い星空を宇宙船の少し背後から飛び、光を短く撃って断つ。断った跡は背景に残り、連続するほど星空が厚くなる。約90秒で前方の一つの星に最接近する。音は出さない。

計画は [docs/plan](docs/plan/) にある。

## 遊び方

- `npm install`
- `npm run dev`
- 表示されたローカルURLをブラウザで開く

マウス、または上下左右の矢印キーで機体と照準が動く。クリック、または Space で一発撃つ。Esc で一時停止する。飛行中は右下にも操作方法を常時表示する。

向こうから飛んでくる隕石を撃ち落とすと、岩片と火花が弾け、命中地点の粒子と背景の星が増える。隕石に機体が触れると残機が減り、背景も一段薄くなる。残機を保って90秒飛ぶと、蓄えた厚みに応じた大きさで目的の星へ最接近する。

## 確認

```sh
npm test
npm run build
```

ゲーム状態はメモリ内だけに置き、音、通信、セーブは使用しない。

## 3Dモデル

`public/models/trace_fighter.glb` は、次のBlender成果物をゲーム配信用にコピーしたもの。

`/Users/ikegayayuuki/workspace/blender-works/output/trace_fighter/exports/trace_fighter.glb`
