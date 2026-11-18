// The PACS bank walk (Brandon, 11/4): field notes for the PACS progress report, walked against one draw.
// The walker checks each item the draw bills (config/sites.json `draw.items`, set when the package is filed)
// and notes what the report's sections ask. Dollars, percent observed, "is the billing acceptable" and the
// PACS flags are not here on purpose: those stay Brandon's calls in /pacs-pr.
//
// The note boxes follow the PACS report (the Farroll Word report and the Emerald / Del Rio Comments tab) and
// the walk sheet that came before this (pacs-pr's assets/field-inspection-form.html).

// what the walker saw of a billed item; anything but Done asks what they saw
export const SEEN = [
  { id: 'done', label: 'Done', tone: 'good' },
  { id: 'partly', label: 'Partly', tone: '' },
  { id: 'not', label: 'Not done', tone: 'bad' },
  { id: 'unseen', label: "Couldn't see", tone: '' },
];
export const SEEN_LABEL = Object.fromEntries(SEEN.map((x) => [x.id, x.label]));

export const NOTES = [
  { id: 'site_work', title: 'Site work', hint: 'Outside the buildings: paving, walks, fences, landscaping, utilities.', picks: ['No site work this period'] },
  { id: 'vertical', title: 'Building and unit work', hint: 'Unit by unit, inside and out: what you saw and how far along it is.', picks: [] },
  { id: 'upcoming', title: 'Upcoming work', hint: 'What the contractor or owner says is next, about the next 30 days. Ask whoever you meet.', picks: ['No info available'] },
  { id: 'trades', title: 'Trades on site', hint: 'Who was working and roughly how many. Company names off trucks help.', picks: ['No workers on site'] },
  { id: 'materials_on', title: 'Materials stored on site', hint: 'What, where, and roughly how much.', picks: ['None observed'] },
  { id: 'materials_off', title: 'Materials stored off site', hint: 'Only if someone mentions it.', picks: ['None reported'] },
  { id: 'changes', title: 'Change orders', hint: 'Approved or pending, extra work, budget moves. Dollar amounts if offered.', picks: ['None reported'] },
  { id: 'schedule', title: 'Schedule and delays', hint: 'Ahead, on pace or behind, and why.', picks: ['On schedule, no delays reported'] },
  { id: 'permits', title: 'Permits and inspections', hint: 'Inspection cards or notices posted, city inspections, any stop-work notice or red tag.', picks: ['Nothing new observed', 'No stop-work notice posted'] },
  { id: 'issues', title: 'Other issues', hint: 'Safety, theft or vandalism, disputes with subs, anything that felt off.', picks: ['None'] },
  { id: 'questions', title: "Questions you couldn't answer", hint: "Anything you couldn't check or weren't sure how to judge. List it rather than guess.", picks: ['None'] },
];

export const WEATHER_PICKS = ['Clear and dry', 'Overcast', 'Rain', 'Windy', 'Muddy ground'];

export const money = (n) => (n === null || n === undefined || n === '' ? '--'
  : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Google Maps for a site: the street address when it has one (a navigation app finds the door), else the pin
export function mapUrl(site) {
  const addr = String((site && site.address) || '').trim();
  const q = /^\d/.test(addr) ? addr : site && typeof site.lat === 'number' ? `${site.lat},${site.lon}` : addr;
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
}

// The walk notes' file name: 'PR#03 Walk Notes - 1345 Farroll Rd (11.05.26).pdf', the house pattern for a
// filed document (what it is, then the date)
export function walkPdfName(template, R) {
  const [y, m, d] = R.date.split('-');
  const pr = (R.draw && R.draw.pr) || '';
  let name = (template || 'PR#{pr} Walk Notes - {name} ({mmddyy}).pdf');
  if (!pr) name = name.replace(/PR#\{pr\}\s*/, '');
  return name.replace('{pr}', pr).replace('{name}', R.site.name).replace('{mmddyy}', `${m}.${d}.${y.slice(2)}`).replace('{date}', R.date);
}

// The loose form (Brandon, 11/17): "since there's not like a formal template that we provide, like it goes into the
// Excel spreadsheet, I'd rather have the form be a little more loosey-goosey, basically a place for me to dump in
// notes, because I'm talking to these contractors and they're bringing up different disparate things, and I don't
// want to be clicking into a bunch of random boxes." One notes box and a record button; the draw's items are a
// reference list with optional taps, and only something written or said is required to sign.
// Claude's pick (his to change): every walker but a QSP delegate gets it, so Brandon's walks are loose and Blake's
// keep the prompts, which help someone who doesn't write the PACS report himself. Keyed on the inspector's role,
// which already reaches the phone, so it needs no script push. The walk keeps its form (`walk.form`), so a
// correction or an older boxed walk still reads the way it was written.
export const looseWalk = (inspector) => !!inspector && inspector.role !== 'delegate';
export const isLoose = (R) => !!(R && R.walk && R.walk.form === 'loose');

// the picks under the notes box: a tap adds the line, nothing more
export const DUMP_PICKS = ['Nobody on site', 'No workers on site', 'No change orders reported', 'On schedule, no delays reported', 'No stop-work notice posted'];
