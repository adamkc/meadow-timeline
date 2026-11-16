// The field guide: what is drawn or heard in the scene, some of the rarer
// plants and animals that depend on California's mountain meadows, and two
// that have not been seen in them for years. No one meadow holds them all, so
// every entry says where it lives. A star marks species found only in
// California. Sources are listed in the README.
//
// `kind` names the plant's pictures in the plant atlas (data/plants.json), for
// its thumbnail; `tree` a picture in the tree atlas (data/cards.json).

const SECTIONS = [
  { title: 'The wet meadow', note: 'Stages 1 to 3, and afterwards only on the new floodplain inside the trench.', entries: [
    { name: 'Sedges and rushes', latin: 'Carex, Juncus', kind: 'sedge', text: 'The sward itself. Their dense roots are the sod that holds a wet meadow together and its water in.' },
    { name: 'Willows', latin: 'Salix', tree: 'willow', text: 'Thickets along the channels. They die back when the water table drops away beneath them, and are the first shrubs onto the new floodplain.' },
    { name: 'Common camas', latin: 'Camassia quamash', kind: 'camas', text: 'Blue-violet stars that can colour a whole wet meadow. Its bulbs were a staple food of Native peoples across the West.' },
    { name: 'Water-plantain buttercup', latin: 'Ranunculus alismifolius', kind: 'buttercup', text: 'Glossy yellow, early, where the ground is wettest.' },
    { name: 'Sierra shooting star', latin: 'Primula jeffreyi', kind: 'shootingstar', text: 'Magenta petals swept back from a dark point. Shooting stars are the food plant of the Sierra Nevada blue butterfly.' },
    { name: 'Western bistort', latin: 'Bistorta bistortoides', kind: 'bistort', text: 'White heads like cotton buds on thin stalks, through the wet and moist meadow.' },
    { name: 'Elephant’s head', latin: 'Pedicularis groenlandica', kind: 'elephantshead', text: 'Each pink flower has an elephant’s ears and upturned trunk. It takes part of its living from the roots of its neighbours.' },
    { name: 'Bigelow’s sneezeweed', latin: 'Helenium bigelovii', kind: 'sneezeweed', text: 'A yellow-brown globe ringed by drooping yellow rays, in moist ground.' },
  ] },
  { title: 'The drying meadow', note: 'Stages 3 to 5, as the terrace dries from its edges inward.', entries: [
    { name: 'Corn lily', latin: 'Veratrum californicum', kind: 'lily', text: 'Tall stems of pleated leaves on ground that is moist but no longer soaked. Poisonous to livestock.' },
    { name: 'Large-leaved lupine', latin: 'Lupinus polyphyllus', kind: 'lupine', text: 'Hand-shaped leaves and spikes of blue-purple flowers on moist ground.' },
    { name: 'Giant red paintbrush', latin: 'Castilleja miniata', kind: 'paintbrush', text: 'The scarlet is not petals but leafy bracts. Like elephant’s head, it taps the roots of other plants.' },
    { name: 'Yarrow', latin: 'Achillea millefolium', kind: 'yarrow', text: 'Feathery grey-green leaves and flat white flower heads: a plant of the drier meadow.' },
    { name: 'Woolly mule’s ears', latin: 'Wyethia mollis', kind: 'mulesears', text: 'Big grey-woolly leaves and yellow sunflower heads on dry, open ground, until brush and trees fill in.' },
    { name: 'Bunchgrasses', latin: '', kind: 'dry', text: 'Dry-ground grasses that replace the sedge sward once the water table has gone.' },
  ] },
  { title: 'The forest', note: 'Around the meadow throughout, and over it from stage 5.', entries: [
    { name: 'Pines and firs', latin: 'Pinus, Abies', tree: 'pine', text: 'Lodgepole pine is the usual invader of a drying mountain meadow, with firs coming up underneath. (The trees drawn here are generic pines and firs.)' },
    { name: 'Bracken fern', latin: 'Pteridium aquilinum', kind: 'bracken', text: 'Broad three-cornered fronds in open forest and at meadow edges.' },
    { name: 'Pinemat manzanita', latin: 'Arctostaphylos nevadensis', kind: 'manzanita', text: 'A mat a hand high, with red-brown stems and small leathery leaves, in the forest’s openings.' },
    { name: 'Snow plant', latin: 'Sarcodes sanguinea', kind: 'snowplant', text: 'All red, with no green in it: it lives on a fungus that lives on the roots of conifers, and pushes up through the needles after the snow melts.' },
  ] },
  { title: 'Seen and heard', note: 'Animals in the scene. They come and go with the timeline.', entries: [
    { name: 'Butterflies', text: 'Over the flowers of the wet and moist meadow; gone when it has dried.' },
    { name: 'Dragonflies', text: 'Over the small channels while they run, and afterwards only along the stream.' },
    { name: 'Swallows', text: 'Hawking insects low over the open meadow, until the young trees close it in.' },
    { name: 'A hawk', text: 'Circling over the meadow throughout.' },
    { name: 'Treefrogs', text: 'A chorus from the wet meadow. It thins as the surface water goes.' },
    { name: 'Blackbirds and sparrows', text: 'Song from the open meadow; a blackbird’s buzzing trill while there is still standing water.' },
    { name: 'Grasshoppers', text: 'A dry, high rasp once the meadow has dried.' },
    { name: 'Chickadee, nuthatch, woodpecker', text: 'The sounds of the closed forest: clear descending whistles, a nasal call, a drum roll on dead wood.' },
  ] },
  { title: 'Meadow specialists you would be lucky to see', note: 'Not drawn here. Rare plants and animals that depend on California’s mountain meadows, each in its own part of the state.', entries: [
    { name: 'Yosemite toad', latin: 'Anaxyrus canorus', only: true, where: 'Central Sierra Nevada, Alpine to Fresno County', text: 'Breeds in the shallow water of high wet meadows. Federally threatened, and gone from about half the places it once lived.' },
    { name: 'Sierra Nevada yellow-legged frog', latin: 'Rana sierrae', where: 'Sierra Nevada', text: 'Lakes, ponds, streams and wet meadows of the high Sierra. Federally endangered.' },
    { name: 'Willow flycatcher', latin: 'Empidonax traillii', where: 'Breeds locally in the Sierra Nevada and Cascades', text: 'Nests in willow thickets in wet meadows. Endangered in California, and declining.' },
    { name: 'Great gray owl', latin: 'Strix nebulosa', where: 'Sierra Nevada, centred on Yosemite', text: 'Hunts voles in large meadows and nests in snags at their edges. The Sierra birds are genetically distinct from great gray owls anywhere else. Endangered in California.' },
    { name: 'Sierra sulphur', latin: 'Colias behrii', only: true, where: 'High Sierra Nevada', text: 'A small green butterfly found only in wet, high meadows of the Sierra, flying in July and August.' },
    { name: 'Sierra Nevada blue', latin: 'Agriades podarce', where: 'High meadows of the Sierra Nevada, north into Oregon', text: 'A small butterfly of boggy meadows and streamsides, never far from the shooting stars its caterpillars eat.' },
    { name: 'Bolander’s clover', latin: 'Trifolium bolanderi', only: true, where: 'Central Sierra Nevada', text: 'A clover of cool, wet mountain meadows. Rare.' },
    { name: 'Yosemite bog orchid', latin: 'Platanthera yosemitensis', only: true, where: 'Nine wet meadows in Yosemite National Park', text: 'Known from nowhere else, and not recognised as a species until 2007.' },
  ] },
  { title: 'Not seen in the meadows now', note: 'Looked for, and not found, for years. They may be gone for good.', entries: [
    { name: 'Franklin’s bumble bee', latin: 'Bombus franklini', where: 'Southern Oregon and far northern California', text: 'It had the smallest range of any bumble bee, in the meadows and grasslands between the Coast Range and the Cascades. Federally endangered, and not seen since the mid-2000s.' },
    { name: 'Single-flowered mariposa lily', latin: 'Calochortus monanthus', only: true, where: 'A meadow on the Shasta River near Yreka', text: 'Known from one plant, collected in June 1876: a single stem with one pinkish, bell-shaped flower, a dark red spot at the base of each petal. Searches since have found nothing, and most of that valley is now farmland. Presumed extinct.' },
  ] },
];

export function createGuide({ plants, cards, onToggle }) {
  const panel = document.getElementById('guide'), button = document.getElementById('guide-button');
  const body = panel.querySelector('.guide-body');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  // A plant's first picture in the atlas, as a thumbnail.
  function thumb(entry) {
    const t = el('span', 'thumb');
    if (entry.kind && plants?.kinds?.[entry.kind]) {
      const i = plants.kinds[entry.kind][0], g = plants.grid;
      t.style.backgroundImage = 'url(data/plants.webp)';
      t.style.backgroundSize = `${g * 100}% ${g * 100}%`;
      t.style.backgroundPosition = `${(i % g) / (g - 1) * 100}% ${Math.floor(i / g) / (g - 1) * 100}%`;
    } else if (entry.tree && cards) {
      const i = cards.trees.findIndex((c) => c.kind === entry.tree);
      if (i >= 0) {
        // One view of the tree, cropped to the part of its cell it fills (cards.json gives that) and fitted to the thumbnail.
        const c = cards.trees[i], [cw, ch] = cards.cell, col = Math.floor(i / cards.rows), row = i % cards.rows, SIZE = 54;
        const [left, right, bottom, top] = c.bounds, w = (right - left) * cw, h = (top - bottom) * ch, k = Math.min(SIZE / w, SIZE / h);
        t.classList.add('tall');
        t.style.backgroundImage = 'url(data/cards_a.webp)';
        t.style.backgroundSize = `${cw * cards.views * cards.columns * k}px ${ch * cards.rows * k}px`;
        t.style.backgroundPosition = `${-(col * cards.views * cw + left * cw) * k + (SIZE - w * k) / 2}px ${-(row * ch + (1 - top) * ch) * k + (SIZE - h * k)}px`;
      }
    } else t.classList.add('none');
    return t;
  }
  let built = false;
  function build() {
    if (built) return;
    built = true;
    for (const s of SECTIONS) {
      body.appendChild(el('h3', '', s.title));
      body.appendChild(el('p', 'note', s.note));
      const list = el('ul');
      for (const e of s.entries) {
        const li = el('li'), text = el('div', 'text'), head = el('div', 'head');
        head.appendChild(el('b', '', e.name + (e.only ? ' *' : '')));
        if (e.latin) head.appendChild(el('i', '', e.latin));
        text.appendChild(head);
        if (e.where) text.appendChild(el('div', 'where', e.where));
        text.appendChild(el('div', '', e.text));
        if (e.kind || e.tree) li.appendChild(thumb(e));
        li.appendChild(text);
        list.appendChild(li);
      }
      body.appendChild(list);
    }
  }
  function toggle(open = panel.hidden) {
    if (open) build(); // the pictures are only fetched (from the browser's cache) when the guide is first opened
    panel.hidden = !open;
    button.classList.toggle('on', open);
    onToggle?.(open);
  }
  button.addEventListener('click', () => toggle());
  panel.querySelector('.close').addEventListener('click', () => toggle(false));
  return { toggle, get open() { return !panel.hidden; } };
}
