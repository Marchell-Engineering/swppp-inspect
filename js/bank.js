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
