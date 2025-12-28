# figuig-axe-socioeco

Architecture Axe 1 (Socio-économique) appliquée **sans refonte UI** : le rendu et la logique restent ceux du dossier d’origine, seules l’organisation des fichiers et les références de chemins ont été normalisées.

## Structure
- `assets/` : logos et icônes
- `css/` : styles externalisés depuis index.html
- `data/boundaries/CT_FIGUIG.geojson` : limites (province/communes)
- `data/axis/socioeco.geojson` : données socio-économiques
- `data/axis/socioeco.meta.json` : méta KPI (prêt pour une modularisation future)
- `js/app.js` : JS externalisé depuis index.html (fonctionnement inchangé)

## Exécution
Utilisez un serveur local (fetch) :
- VS Code Live Server
- `python -m http.server 5500`
