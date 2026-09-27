// Landmark line drawings, one per park, used for the skyline along the
// bottom of the dashboard (which doubles as the park picker) and in the setup
// wizard's resort choices.
//
// GENERATED from the shared landmark set that also drives the 3D-printed frames
// and the shareable art, so all three always match. Coordinates are frame
// millimetres: every drawing shares the same vertical range (y 1-42.5, ground at
// y=41), so they keep their true relative sizes; each viewBox only sets its own
// width. Inside each: "outline" paths are the line art, "fill" is the solid
// silhouette shown when that park is selected, and "cutout" (e.g. a castle's
// doorway) stays open when filled. Styles are in style.css.

const LANDMARKS = {
  wdwCastle: {
    label: "Cinderella Castle",
    viewBox: "40.5 1 24 41.5",
    svg: `
      <path class="fill" d="M42 41 V31 H43 V28 L44 24 L45 28 V31 H46 V26 H47 V22 L48 19 L49 22 V20 H50 V14 L51 11 L52 14 L53 2 L54 14 L55 11 L56 14 V20 H57 V22 L58 19 L59 22 V26 H60 V29 L61 26 L62 29 V31 H63 V35 H64 V41 Z"/>
      <path class="cutout" d="M50.5 41 V38 Q53 35 55.5 38 V41 Z"/>
      <path class="outline" d="M42 41 V31 H43 V28 L44 24 L45 28 V31 H46 V26 H47 V22 L48 19 L49 22 V20 H50 V14 L51 11 L52 14 L53 2 L54 14 L55 11 L56 14 V20 H57 V22 L58 19 L59 22 V26 H60 V29 L61 26 L62 29 V31 H63 V35 H64 V41"/>
      <path class="outline" d="M50.5 41 V38 Q53 35 55.5 38 V41"/>
    `,
  },
  spaceshipEarth: {
    label: "Spaceship Earth",
    viewBox: "64.5 1 23 41.5",
    svg: `
      <circle class="fill" cx="76.00" cy="26.50" r="10.50"/>
      <path class="outline" d="M71.5 35.8 V41 M80.5 35.8 V41"/>
      <circle class="outline" cx="76.00" cy="26.50" r="10.50"/>
    `,
  },
  towerOfTerror: {
    label: "Tower of Terror",
    viewBox: "87 1 21 41.5",
    svg: `
      <path class="fill" d="M88 41 V30 H90 V17 L90.5 15 L91 17 H93 L94 15.5 L95 14 L96 13.5 L97 12 L98 13.5 L99 14 L100 15.5 L101 17 H103 L103.5 15 L104 17 V27 H107 V41 Z"/>
      <path class="outline" d="M88 41 V30 H90 V17 L90.5 15 L91 17 H93 L94 15.5 L95 14 L96 13.5 L97 12 L98 13.5 L99 14 L100 15.5 L101 17 H103 L103.5 15 L104 17 V27 H107 V41"/>
    `,
  },
  treeOfLife: {
    label: "Tree of Life",
    viewBox: "107.5 1 27 41.5",
    svg: `
      <path class="fill" d="M117 41 Q119 40 119.5 37.5 Q120 35 119 32.5 Q117 33.5 115 33 Q113 34.5 110 33 Q108.5 30 111 28 Q110 24 113 22 Q113.5 18 117.5 18 Q119.5 15 123 16.5 Q126 14.5 128 17.5 Q131.5 17.5 131 21.5 Q133.5 24 131.5 27 Q132.5 30.5 129 31 Q126 33 123 32.5 Q121.5 35 122.5 38 Q123 40.5 126 41 Z"/>
      <path class="outline" d="M110 33 Q113 34.5 115 33 Q117 33.5 119 32.5 Q120 35 119.5 37.5 Q119 40 117 41"/>
      <path class="outline" d="M110 33 Q108.5 30 111 28 Q110 24 113 22 Q113.5 18 117.5 18 Q119.5 15 123 16.5 Q126 14.5 128 17.5 Q131.5 17.5 131 21.5 Q133.5 24 131.5 27 Q132.5 30.5 129 31 Q126 33 123 32.5 Q121.5 35 122.5 38 Q123 40.5 126 41"/>
    `,
  },
  mountPrometheus: {
    label: "Mount Prometheus",
    viewBox: "0.0 1 55.8 41.5",
    svg: `
      <path class="fill" d="M 1.5 41 L 6.9 37.7 L 10.5 35 L 13.5 31.1 L 15.9 28.4 L 17.7 25.1 L 19.5 21.5 L 21.3 18.5 L 22.5 17 L 23.4 17.75 L 24.3 16.25 L 25.5 17.45 L 26.7 15.95 L 27.9 17.15 L 29.1 16.25 L 30.3 17.6 L 31.5 16.85 L 32.7 18.65 L 34.5 21.8 L 36.3 25.4 L 38.7 29 L 41.7 32.6 L 45.9 36.2 L 50.7 38.9 L 54.3 41 Z"/>
      <path class="fill" d="M 24.3 16.25 Q 21.6 14.6 23.7 12.5 Q 22.2 9.8 25.5 9.2 Q 26.1 6.2 29.7 6.8 Q 32.1 4.4 35.1 6.8 Q 38.1 6.2 38.1 9.2 Q 40.5 10.4 38.7 12.8 Q 38.1 15.2 34.5 14.6 Q 32.4 16.4 29.1 16.25 L 27.9 17.15 L 26.7 15.95 L 25.5 17.45 Z"/>
      <path class="outline" d="M 1.5 41 L 6.9 37.7 L 10.5 35 L 13.5 31.1 L 15.9 28.4 L 17.7 25.1 L 19.5 21.5 L 21.3 18.5 L 22.5 17 L 23.4 17.75 L 24.3 16.25 L 25.5 17.45 L 26.7 15.95 L 27.9 17.15 L 29.1 16.25 L 30.3 17.6 L 31.5 16.85 L 32.7 18.65 L 34.5 21.8 L 36.3 25.4 L 38.7 29 L 41.7 32.6 L 45.9 36.2 L 50.7 38.9 L 54.3 41"/>
      <path class="outline" d="M 17.7 25.1 L 20.1 27.5 L 18.9 29.9 L 21.3 32.3"/>
      <path class="outline" d="M 34.5 21.8 L 32.7 24.8 L 34.5 27.8 L 32.7 30.8"/>
      <path class="outline" d="M 26.7 17.6 Q 24.9 23 26.7 27.8 Q 28.2 32 26.1 37.1"/>
      <path class="outline" d="M 24.3 16.25 Q 21.6 14.6 23.7 12.5 Q 22.2 9.8 25.5 9.2 Q 26.1 6.2 29.7 6.8 Q 32.1 4.4 35.1 6.8 Q 38.1 6.2 38.1 9.2 Q 40.5 10.4 38.7 12.8 Q 38.1 15.2 34.5 14.6 Q 32.4 16.4 29.1 16.25"/>
    `,
  },
  sleepingBeautyCastle: {
    label: "Sleeping Beauty Castle",
    viewBox: "0.0 1 43.0 41.5",
    svg: `
      <path class="fill" d="M 1.5 41 V 29 H 5.5 V 25 L 8 19 L 10.5 25 V 29 H 13.5 V 23 L 16 16 L 18.5 23 V 19 L 21.5 7 L 24.5 19 V 23 L 27 16 L 29.5 23 V 29 H 32.5 V 25 L 35 19 L 37.5 25 V 29 H 41.5 V 41 Z"/>
      <path class="fill" d="M 21.5 3 L 26 4.5 L 21.5 6 Z"/>
      <path class="cutout" d="M 18 41 V 36 Q 21.5 32 25 36 V 41 Z"/>
      <path class="outline" d="M 1.5 41 V 29 H 5.5 V 25 L 8 19 L 10.5 25 V 29 H 13.5 V 23 L 16 16 L 18.5 23 V 19 L 21.5 7 L 24.5 19 V 23 L 27 16 L 29.5 23 V 29 H 32.5 V 25 L 35 19 L 37.5 25 V 29 H 41.5 V 41"/>
      <path class="outline" d="M 18 41 V 36 Q 21.5 32 25 36 V 41"/>
      <path class="outline" d="M 21.5 7 V 3 L 26 4.5 L 21.5 6"/>
    `,
  },
  palARound: {
    label: "Pixar Pal-A-Round",
    viewBox: "3.0 1 36.9 41.5",
    svg: `
      <circle class="fill" cx="21.50" cy="17.50" r="16.00"/>
      <circle class="fill" cx="37.50" cy="20.00" r="2.20"/>
      <circle class="fill" cx="32.81" cy="31.31" r="2.20"/>
      <circle class="fill" cx="21.50" cy="36.00" r="2.20"/>
      <circle class="fill" cx="10.19" cy="31.31" r="2.20"/>
      <circle class="fill" cx="5.50" cy="20.00" r="2.20"/>
      <circle class="fill" cx="10.19" cy="8.69" r="2.20"/>
      <circle class="fill" cx="21.50" cy="4.00" r="2.20"/>
      <circle class="fill" cx="32.81" cy="8.69" r="2.20"/>
      <path class="outline" d="M21.5 17.5 L36.28 23.62 M21.5 17.5 L27.62 32.28 M21.5 17.5 L15.38 32.28 M21.5 17.5 L6.72 23.62 M21.5 17.5 L6.72 11.38 M21.5 17.5 L15.38 2.72 M21.5 17.5 L27.62 2.72 M21.5 17.5 L36.28 11.38"/>
      <path class="outline" d="M21.5 17.5 L12.5 41 M21.5 17.5 L30.5 41"/>
      <circle class="outline" cx="21.50" cy="17.50" r="16.00"/>
      <circle class="outline" cx="21.50" cy="17.50" r="10.00"/>
      <circle class="outline" cx="21.50" cy="17.50" r="2.50"/>
      <circle class="outline" cx="37.50" cy="20.00" r="0.95"/>
      <circle class="outline" cx="32.81" cy="31.31" r="0.95"/>
      <circle class="outline" cx="21.50" cy="36.00" r="0.95"/>
      <circle class="outline" cx="10.19" cy="31.31" r="0.95"/>
      <circle class="outline" cx="5.50" cy="20.00" r="0.95"/>
      <circle class="outline" cx="10.19" cy="8.69" r="0.95"/>
      <circle class="outline" cx="21.50" cy="4.00" r="0.95"/>
      <circle class="outline" cx="32.81" cy="8.69" r="0.95"/>
    `,
  },
  parisCastle: {
    label: "Le Château de la Belle au Bois Dormant",
    viewBox: "0.0 1 39.0 41.5",
    svg: `
      <path class="fill" d="M 1.5 41 V 27 H 4.5 V 23 L 6.5 17 L 8.5 23 V 27 H 11.5 V 21 L 13.5 14 L 15.5 21 V 19 H 17.5 L 19.5 1 L 21.5 19 H 23.5 V 21 L 25.5 14 L 27.5 21 V 27 H 30.5 V 23 L 32.5 17 L 34.5 23 V 27 H 37.5 V 41 Z"/>
      <path class="cutout" d="M 16.5 41 V 36 Q 19.5 32.5 22.5 36 V 41 Z"/>
      <path class="outline" d="M 1.5 41 V 27 H 4.5 V 23 L 6.5 17 L 8.5 23 V 27 H 11.5 V 21 L 13.5 14 L 15.5 21 V 19 H 17.5 L 19.5 1 L 21.5 19 H 23.5 V 21 L 25.5 14 L 27.5 21 V 27 H 30.5 V 23 L 32.5 17 L 34.5 23 V 27 H 37.5 V 41"/>
      <path class="outline" d="M 16.5 41 V 36 Q 19.5 32.5 22.5 36 V 41"/>
    `,
  },
  parisTowerOfTerror: {
    label: "Tower of Terror",
    viewBox: "86.5 1 22.0 41.5",
    svg: `
      <path class="fill" d="M88 41 V30 H90 V17 L90.5 15 L91 17 H93 L94 15.5 L95 14 L96 13.5 L97 12 L98 13.5 L99 14 L100 15.5 L101 17 H103 L103.5 15 L104 17 V27 H107 V41 Z"/>
      <path class="outline" d="M88 41 V30 H90 V17 L90.5 15 L91 17 H93 L94 15.5 L95 14 L96 13.5 L97 12 L98 13.5 L99 14 L100 15.5 L101 17 H103 L103.5 15 L104 17 V27 H107 V41"/>
    `,
  },
  enchantedStorybookCastle: {
    label: "Enchanted Storybook Castle",
    viewBox: "0.0 1 43.0 41.5",
    svg: `
      <path class="fill" d="M 1.5 41 V 31 H 4.5 V 27 L 6.5 22 L 8.5 27 V 31 H 11.5 V 25 L 13.5 19 L 15.5 25 V 23 H 17 Q 16.5 17 19.5 15 Q 20.5 12.5 20 11.5 L 21.5 4.5 L 23 11.5 Q 22.5 12.5 23.5 15 Q 26.5 17 26 23 H 27.5 V 25 L 29.5 19 L 31.5 25 V 31 H 34.5 V 27 L 36.5 22 L 38.5 27 V 31 H 41.5 V 41 Z"/>
      <circle class="fill" cx="21.50" cy="2.40" r="0.95"/>
      <path class="cutout" d="M 18 41 V 36 Q 21.5 32 25 36 V 41 Z"/>
      <path class="outline" d="M 1.5 41 V 31 H 4.5 V 27 L 6.5 22 L 8.5 27 V 31 H 11.5 V 25 L 13.5 19 L 15.5 25 V 23 H 17 Q 16.5 17 19.5 15 Q 20.5 12.5 20 11.5 L 21.5 4.5 L 23 11.5 Q 22.5 12.5 23.5 15 Q 26.5 17 26 23 H 27.5 V 25 L 29.5 19 L 31.5 25 V 31 H 34.5 V 27 L 36.5 22 L 38.5 27 V 31 H 41.5 V 41"/>
      <path class="outline" d="M 18 41 V 36 Q 21.5 32 25 36 V 41"/>
      <circle class="outline" cx="21.50" cy="2.40" r="0.95"/>
    `,
  },
};

// An inline <svg> for a landmark, ready to style with the classes above.
function landmarkSvg(key) {
  const landmark = LANDMARKS[key];
  const width = landmark.viewBox.split(" ")[2];
  return `<svg class="landmark" viewBox="${landmark.viewBox}" width="${width}" height="41.5" aria-hidden="true">${landmark.svg}</svg>`;
}

if (typeof module !== "undefined") module.exports = { LANDMARKS, landmarkSvg };
