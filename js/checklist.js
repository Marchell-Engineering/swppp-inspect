// The inspection checklist. It began as Brandon's ComplianceGo "CA SWPPP" form (built 4/29/2026), question
// for question, read from the VLC report PDFs. Changed 10/22 on his word ("Yes to all"):
//   - Yes always means good. A question's `bad` answer is No (the spill and discharge questions used to flip),
//     and the bad answer asks for a description (Att. D III.C.7.e) and offers an action item (III.C.7.h).
//   - Bundled questions are split, so a No says which part failed (trash, sanitary, washouts, entrances).
//   - The checks the permit lists for storm inspections show only on those: pre-storm III.C.3.a and c
//     (b is the whole checklist), post-storm III.C.5.a-c. Sweeping before the storm shows on pre-storm only.
//   - "Does the SWPPP still match the site" on every inspection (III.C.7.h: changes to the SWPPP).
//   - A spill that wasn't cleaned up before it could reach a discharge raises the non-visible sampling
//     warning (Att. D III.D.3.b-e).
//   - During- and post-storm inspections ask whether the gauge was emptied after its reading (Brandon, 10/22).
//     The permit wants a reading every inspection (III.C.7.c; CASQA FAQ Visual Inspections Q8) and the QPE's
//     total for the post-storm trigger (III.C.5); read, record with the time, then empty, so each reading is
//     the rain since the last visit and a storm's readings add up to its total. A No is a plain record, like
//     the samples question: no red, no "what's wrong," no action item (Brandon, 10/22).
// Questions that changed meaning got new ids, so an old report's answers never read under the new wording.
//
// ComplianceGo's "Has the NOAA forecast been checked?" is gone: the app pulls the NWS forecast itself and
// attaches it to the report (Brandon, 10/21: "just show the actual noaa forecast attachment instead"), and
// the inspection type is worked out from it (weather.js classify), so the inspector only confirms.
//
// What III.C.7 asks for, and where this form carries it:
//   a inspection type ........ TYPES             f BMPs inspected ......... the BMP sections
//   b date and time .......... start/finish time g sheens, odors, etc. .... obs_clear
//   c weather, QPE, inches ... weather + site info h corrective actions ..... action items, g_swppp_match
//   d stage, activities, area  site info         i photos of concerns ..... photos on items and deficiencies
//   e deficiencies ........... notes on bad answers j inspector, title, cert  signature block
//
// `when`: the question or section shows only on those inspection types. `after`: the question shows only
// once another question has that answer. `alert`: a warning shown to the inspector on the bad answer
// (on the phone only, not on the report).

export const TYPES = [
  { id: 'weekly', label: 'Routine weekly' },
  { id: 'pre', label: 'Pre-storm (QPE)' },
  { id: 'during', label: 'During storm (QPE)' },
  { id: 'post', label: 'Post-storm (0.5" or more measured)' },
];

const YN = ['yes', 'no'];
const YNA = ['yes', 'no', 'na'];

export const SECTIONS = [
  {
    id: 'general',
    title: 'General',
    questions: [
      { id: 'g_gauge_log', text: 'Is the on-site rain gauge log up to date?', options: YN, bad: 'no' },
      { id: 'g_gauge_emptied', text: 'Was the rain gauge emptied after its reading was recorded?', options: YN, when: ['during', 'post'] },
      { id: 'g_swppp', text: 'Is the SWPPP on-site and up to date?', options: YN, bad: 'no' },
      { id: 'g_swppp_match', text: 'Does the SWPPP still match the site, with no amendment needed (BMPs, layout, phase of work)?', options: YN, bad: 'no' },
      { id: 'g_samples', text: 'Were any stormwater samples collected during the inspection? If yes, report results in the Sampling Log.', options: YN },
      { id: 'g_discharge', text: 'Was the site discharging stormwater at the time of inspection?', options: YN },
    ],
  },
  {
    id: 'pre',
    title: 'Pre-Storm Checks',
    when: ['pre'],
    questions: [
      { id: 'pre_drainage', label: 'Drainage Areas', text: 'Are all stormwater drainage areas free of leaks, spills, and uncontrolled pollutant sources?', options: YN, bad: 'no' },
      { id: 'pre_containment', label: 'Storage and Containment', text: 'Are all stormwater storage and containment areas free of leaks, with room to spare so they won\'t overflow?', options: YNA, bad: 'no' },
    ],
  },
  {
    id: 'post',
    title: 'Post-Storm Checks',
    when: ['post'],
    questions: [
      { id: 'post_effective', label: 'BMP Performance', text: 'Did the BMPs hold up and work as intended through the storm?', options: YN, bad: 'no' },
      { id: 'post_damage', label: 'Storm Damage', text: 'Are the BMPs free of storm damage, with none needing repair or replacement?', options: YN, bad: 'no' },
      { id: 'post_more', label: 'Additional BMPs', text: 'Are the BMPs in place enough, with no new ones needed? (A No also means the SWPPP gets revised.)', options: YN, bad: 'no' },
    ],
  },
  {
    id: 'erosion',
    title: 'Erosion Control BMPs',
    questions: [
      { id: 'ec_active', label: 'Protection of Active Disturbed Soil Areas', text: 'Are applicable BMPs installed and operating effectively?', options: YNA, bad: 'no' },
      { id: 'ec_inactive', label: 'Protection of Inactive Disturbed Soil Areas', text: 'Is there adequate coverage/stabilization of inactive DSA?', options: YNA, bad: 'no' },
      { id: 'ec_slope', label: 'Slope Protection', text: 'Have slope protection BMPs been installed per CGP requirements and QSD SWPPP design?', options: YNA, bad: 'no' },
      { id: 'ec_veg', label: 'Preserve Existing Vegetation', text: 'Has vegetation been preserved where possible on-site?', options: YNA, bad: 'no' },
      { id: 'ec_velocity', label: 'Velocity Dissipation Devices', text: 'Have appropriate velocity dissipation BMPs been installed as needed?', options: YNA, bad: 'no' },
      { id: 'ec_wind', label: 'Wind Erosion/Dust Control', text: 'Are dust control BMPs present and being used properly to control dust?', options: YNA, bad: 'no' },
    ],
  },
  {
    id: 'sediment',
    title: 'Sediment Control BMPs',
    questions: [
      { id: 'sc_checkdams', label: 'Check Dams', text: 'Are check dams intact and functioning, and is accumulated sediment less than 1/3 height of the check dam?', options: YNA, bad: 'no' },
      { id: 'sc_siltfence', label: 'Silt Fence', text: 'Is silt fence installed per BMP specification with no tears and is accumulated sediment less than 1/3 height?', options: YNA, bad: 'no' },
      { id: 'sc_fiberrolls', label: 'Fiber Rolls', text: 'Are fiber rolls installed per BMP specification and is accumulated sediment less than 1/2 the height of the fiber roll?', options: YNA, bad: 'no' },
      { id: 'sc_berms', label: 'Gabions, Berms, Dikes', text: 'Are BMPs installed per specification sheet requirements and/or as defined by the SWPPP document?', options: YNA, bad: 'no' },
      { id: 'sc_basins', label: 'Sediment Basins and Sediment Traps', text: 'Is sediment build up properly contained within the BMP?', options: YNA, bad: 'no' },
      { id: 'sc_stockpiles', label: 'Stockpile Management', text: 'Are stockpiles properly contained and/or covered?', options: YNA, bad: 'no' },
      { id: 'sc_inlets', label: 'Storm Drain Inlet Protection', text: 'Is the inlet protection properly installed per the manufacturer guidelines and/or specification sheets in the SWPPP document, and are the maintenance requirements being properly followed?', options: YNA, bad: 'no' },
      { id: 'sc_sweeping_routine', label: 'Street Sweeping', text: 'Is routine sweeping being done?', options: YNA, bad: 'no' },
      { id: 'sc_sweeping_pre', text: 'Is sweeping scheduled before the forecast storm?', options: YNA, bad: 'no', when: ['pre'] },
    ],
  },
  {
    id: 'housekeeping',
    title: 'Housekeeping & Non-Stormwater BMPs',
    questions: [
      { id: 'hk_waste_bins', label: 'Waste and Trash Management', text: 'Is debris and trash going into the proper waste or recycling containers?', options: YNA, bad: 'no' },
      { id: 'hk_waste_covered', text: 'Are trash containers covered at the end of each day and during rain?', options: YNA, bad: 'no' },
      { id: 'hk_waste_contained', text: 'Are discharges from waste containers kept out of the storm drain system and receiving waters?', options: YNA, bad: 'no' },
      { id: 'hk_sanitary_contained', label: 'Sanitary Station Management', text: 'Do sanitary stations have secondary containment, with no leaks or spills?', options: YNA, bad: 'no' },
      { id: 'hk_sanitary_located', text: 'Are sanitary stations set away from receiving waters and storm drain inlets?', options: YNA, bad: 'no' },
      { id: 'hk_spills_free', label: 'Spill Prevention & Control', text: 'Is the site free of spills and leaks of potential pollutants?', options: YN, bad: 'no' },
      {
        id: 'hk_spill_cleaned', text: 'Was the spill fully cleaned up or removed, with its BMPs fixed, before it could reach a discharge?', options: YN, bad: 'no',
        after: { q: 'hk_spills_free', a: 'no' },
        alert: 'If it may reach stormwater leaving the site, a non-visible pollutant sample is owed: at least one within 8 hours from each discharge point downhill of it, then one for each 24 hours of discharge until it is under control (Att. D III.D.3). Call Brandon before you leave the site.',
      },
      { id: 'hk_concrete_contained', label: 'Concrete Waste Management', text: 'Are concrete washouts contained, with no leaks or overflow?', options: YNA, bad: 'no' },
      { id: 'hk_concrete_covered', text: 'Are concrete washouts covered during rain?', options: YNA, bad: 'no' },
      { id: 'hk_washout_contained', label: 'Construction Washout Management', text: 'Are washouts for paint, stucco, drywall, masonry, etc. contained?', options: YNA, bad: 'no' },
      { id: 'hk_washout_covered', text: 'Are those washouts covered during rain?', options: YNA, bad: 'no' },
      { id: 'hk_materials', label: 'Material Storage', text: 'Are construction materials being protected from exposure to rain?', options: YNA, bad: 'no' },
      { id: 'hk_vehicles', label: 'Vehicle and Equipment Cleaning, Fueling, Storage, and Maintenance', text: 'Have BMPs been installed to contain fuel, greases, oils, etc. from leaking onto the ground and/or being discharged in storm water during rain events?', options: YNA, bad: 'no' },
      { id: 'hk_entrance_installed', label: 'Stabilized Construction Entrance/Exit', text: 'Are stabilized construction entrances/exits installed where needed?', options: YNA, bad: 'no' },
      { id: 'hk_entrance_tracking', text: 'Are they keeping sediment and loose material from tracking onto paved surfaces?', options: YNA, bad: 'no' },
      { id: 'hk_nonstorm', label: 'Non-Stormwater Management', text: 'Are measures in place to adequately control/eliminate non-stormwater discharges?', options: YNA, bad: 'no' },
    ],
  },
  {
    id: 'observations',
    title: 'Discharge Observations',
    questions: [
      { id: 'obs_clear', text: 'Were discharges and contained stormwater free of floating or suspended material, odors, discoloration, visible sheens, and pollutant sources?', options: YNA, bad: 'no' },
    ],
  },
];

export const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.id })));

// what this inspection shows: R is the report (its types and answers)
const forTypes = (x, R) => !x.when || x.when.some((t) => (R.types || []).includes(t));
export const shownSections = (R) => SECTIONS.filter((s) => forTypes(s, R) && shownQuestions(s, R).length);
export const shownQuestions = (s, R) => s.questions.filter((q) => forTypes(q, R) && (!q.after || (R.answers || {})[q.after.q] === q.after.a));
// the sections that change with the inspection type, redrawn when the type changes
export const TYPE_SECTIONS = SECTIONS.filter((s) => s.when || s.questions.some((q) => q.when)).map((s) => s.id);
// questions another question follows, so answering them redraws their section
export const LEADS = new Set(ALL_QUESTIONS.filter((q) => q.after).map((q) => q.after.q));

// "Couldn't inspect": the permit's reasons an inspection may be skipped (Att. D III.B.1); every missed one is
// explained in the Annual Report (III.B.2)
export const MISSED_REASONS = [
  { id: 'weather', label: 'Dangerous weather (electrical storm, flooding, or wind over 40 mph)', cite: 'III.B.1.a' },
  { id: 'hours', label: 'Outside scheduled site operating hours', cite: 'III.B.1.b' },
  { id: 'access', label: 'Site not accessible to personnel', cite: 'III.B.1.c' },
];

export const PHASES = ['Demolition', 'Clearing and Grubbing', 'Mass Grading', 'Utility Installation', 'Vertical Construction', 'Paving', 'Post-Construction'];

export const ANSWER_LABEL = { yes: 'Yes', no: 'No', na: 'N/A' };

export const PRIORITY_DAYS = [3, 7, 14];

// Numeric action levels for Risk Level 2 and 3 (Order IV.C.3.c-d): pH 6.5 to 8.5, read to two decimals;
// turbidity over 250 NTU
export const NAL = { ph_low: 6.5, ph_high: 8.5, ntu: 250 };
