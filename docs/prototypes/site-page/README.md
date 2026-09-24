# Prototype: site page with a Photos tab (issue #90)

Throwaway. Branch `prototype/site-page`. Run `npm run dev` and open `/sites`.

- `/sites`: the Sites list, one search box, New site (address, then customer search that can add a customer inline). Saves for real.
- `/sites/<id>`: the site page. Three header variants on the same route, switched with `?variant=A|B|C` or the purple bar at the bottom:
  - A Plain: the customer hub's look one level down, underline tabs.
  - B Sticky: compact header that sticks on scroll, pill tabs, floating Take photo on the phone.
  - C Card: header as a card of rows, full-width tabs.
- Photos tab: in memory only, shrunk in the browser to 2000px and 400px JPEGs, gone on reload.
- `/customers/<id>`: the thin customer page (contact, site cards, Documents). Old tab routes show the same page.

Screenshots in this folder.
