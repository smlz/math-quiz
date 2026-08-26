correct_answer: B
answer_area_fraction: 0.6

```typst
Gegeben sind $A = { 2, 4, 6, 8, 9 }$ und $B = { 1, 3, 4, 6, 7 }$.

Was ist $A inter B$?
```

```typst-option
${ 2, 8, 9 }$
```

```typst-option
${ 4, 6 }$
```

```typst-option
${ 1, 3, 7 }$
```

```typst-option
${ 1, 2, 3, 4, 6, 7, 8, 9 }$
```

---

correct_answer: D
answer_area_fraction: 0.6

```typst
Wieder mit $A = { 2, 4, 6, 8, 9 }$ und $B = { 1, 3, 4, 6, 7 }$.

Was ist $A without B$?
```

```typst-option
${ 1, 3, 7 }$
```

```typst-option
${ 4, 6 }$
```

```typst-option
${ 1, 2, 3, 7, 8, 9 }$
```

```typst-option
${ 2, 8, 9 }$
```

---

correct_answer: A
answer_area_fraction: 0.6

```typst
Immer noch $A = { 2, 4, 6, 8, 9 }$ und $B = { 1, 3, 4, 6, 7 }$.

Was ist $(A without B) union (B without A)$?
```

```typst-option
${ 1, 2, 3, 7, 8, 9 }$
```

```typst-option
${ 1, 2, 3, 4, 6, 7, 8, 9 }$
```

```typst-option
${ 4, 6 }$
```

```typst-option
${ }$
```

---

correct_answer: C
answer_area_fraction: 0.7

```typst
Welche Aussage ist für *alle* Mengen $A$ und $B$ wahr?
```

```typst-option
$(A union B) subset B$
```

```typst-option
$A subset (A inter B)$
```

```typst-option
$(A inter B) subset A$
```

```typst-option
$B subset (A without B)$
```

---

correct_answer: A
answer_area_fraction: 0.7

```typst
Vereinfache: $A inter (B union A) = $ ?
```

```typst-option
$A$
```

```typst-option
$B$
```

```typst-option
$A inter B$
```

```typst-option
${ }$
```

---

correct_answer: C
answer_area_fraction: 0.8

```typst
Welches Diagramm zeigt $B without A$?
```

```typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: rgb("#4a90d9"), b-fill: white, ab-fill: white, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
```

```typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: white, b-fill: white, ab-fill: rgb("#4a90d9"), stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
```

```typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: white, b-fill: rgb("#4a90d9"), ab-fill: white, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
```

```typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: rgb("#4a90d9"), b-fill: rgb("#4a90d9"), ab-fill: white, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
```
