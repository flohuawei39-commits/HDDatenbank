/* Kennung der ausgelieferten Fassung.

   Sie steht bewusst hier und nicht in `index.html`: die Module unter `lib/` laedt
   `app.js` selbst nach und sie tragen deshalb kein `?v=` im Verweis. Zeigen die
   Einstellungen eine alte Kennung, liegt `lib/` noch im Zwischenspeicher des
   Browsers — genau das soll damit sichtbar werden.

   Bei jeder Veroeffentlichung mitziehen, zusammen mit dem `?v=` in `index.html`. */

const FASSUNG = '2026-08-31b';

export { FASSUNG };
