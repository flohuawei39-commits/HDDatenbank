/* Kennung der ausgelieferten Fassung.

   Sie steht bewusst hier und nicht nur in `index.html`: die Einstellungen zeigen
   sie an, und damit sieht man auf einen Blick, welcher Stand im Browser liegt.

   Bei jeder Veroeffentlichung mitziehen — zusammen mit dem `?v=` an app.js und
   style.css UND mit jedem Eintrag der Importkarte in `index.html`, die dieselbe
   Kennung an die Module unter `lib/` haengt. Der Selbsttest prueft das nach. */

const FASSUNG = '2026-09-03';

export { FASSUNG };
