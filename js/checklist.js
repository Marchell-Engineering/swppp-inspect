// The inspection checklist: Brandon's ComplianceGo "CA SWPPP" form (built 4/29/2026), question for question,
// read from the VLC report PDFs, with its typos fixed. Each question's `bad` answer is the one that needs a
// description of the problem (Att. D III.C.7.e) and offers an action item (III.C.7.h).
//
// ComplianceGo's "Has the NOAA forecast been checked?" is gone: the app pulls the NWS forecast itself and
// attaches it to the report (Brandon, 10/21: "just show the actual noaa forecast attachment instead"), and
// the inspection type is worked out from it (weather.js classify), so the inspector only confirms.
//
// What III.C.7 asks for, and where this form carries it:
//   a inspection type ........ TYPES             f BMPs inspected ......... the BMP sections
//   b date and time .......... start/finish time g sheens, odors, etc. .... obs_pollutants
//   c weather, QPE, inches ... weather + site info h corrective actions ..... action items with due dates
//   d stage, activities, area  site info         i photos of concerns ..... photos on items and deficiencies
//   e deficiencies ........... notes on bad answers j inspector, title, cert  signature block

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
      { id: 'g_swppp', text: 'Is the SWPPP on-site and up to date?', options: YN, bad: 'no' },
      { id: 'g_samples', text: 'Were any stormwater samples collected during the inspection? If yes, report results in the Sampling Log.', options: YN },
      { id: 'g_discharge', text: 'Was the site discharging stormwater at the time of inspection?', options: YN },
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
      { id: 'sc_sweeping', label: 'Street Sweeping', text: 'Is routine sweeping being conducted? If pre-storm, is sweeping scheduled prior to the anticipated storm event?', options: YNA, bad: 'no' },
    ],
  },
  {
    id: 'housekeeping',
    title: 'Housekeeping & Non-Stormwater BMPs',
    questions: [
      { id: 'hk_waste', label: 'Waste and Trash Management', text: 'Is debris or trash being disposed of in the proper waste or recycling container? Are trash receptacles being covered at the end of each day and at all times during a rain event? Have discharges from waste disposal containers been prevented from entering the storm water drainage system or receiving water?', options: YNA, bad: 'no' },
      { id: 'hk_sanitary', label: 'Sanitary Station Management', text: 'Do sanitary stations have secondary containment and are they free of leaks or spills? Are they located away from receiving waters and storm drain inlet locations?', options: YNA, bad: 'no' },
      { id: 'hk_spills', label: 'Spill Prevention & Control', text: 'Were any spills or leaks of potential pollutants observed?', options: YNA, bad: 'yes' },
      { id: 'hk_concrete', label: 'Concrete Waste Management', text: 'Are the concrete washout areas properly contained? Are washouts covered during rain events?', options: YNA, bad: 'no' },
      { id: 'hk_washout', label: 'Construction Washout Management', text: 'Are washouts for paint, stucco, drywall, and masonry work etc. properly contained? Are washouts covered during rain events?', options: YNA, bad: 'no' },
      { id: 'hk_materials', label: 'Material Storage', text: 'Are construction materials being protected from exposure to rain?', options: YNA, bad: 'no' },
      { id: 'hk_vehicles', label: 'Vehicle and Equipment Cleaning, Fueling, Storage, and Maintenance', text: 'Have BMPs been installed to contain fuel, greases, oils, etc. from leaking onto the ground and/or being discharged in storm water during rain events?', options: YNA, bad: 'no' },
      { id: 'hk_entrance', label: 'Stabilized Construction Entrance/Exit', text: 'Are stabilized construction access points installed where needed? Are stabilized access points effective in controlling the tracking of sediment and loose construction materials onto impervious surfaces?', options: YNA, bad: 'no' },
      { id: 'hk_nonstorm', label: 'Non-Stormwater Management', text: 'Are measures in place to adequately control/eliminate non-stormwater discharges?', options: YNA, bad: 'no' },
    ],
  },
  {
    id: 'observations',
    title: 'Discharge Observations',
    questions: [
      { id: 'obs_pollutants', text: 'Were any of the following observed during the inspection: floating or suspended materials, odors, discolorations, visible sheens, or any sources of pollutants in discharges and/or contained stormwater?', options: YNA, bad: 'yes' },
    ],
  },
];

export const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.id })));

export const PHASES = ['Demolition', 'Clearing and Grubbing', 'Mass Grading', 'Utility Installation', 'Vertical Construction', 'Paving', 'Post-Construction'];

export const ANSWER_LABEL = { yes: 'Yes', no: 'No', na: 'N/A' };

export const PRIORITY_DAYS = [3, 7, 14];

// Numeric action levels for Risk Level 2 and 3 (Order IV.C.3.c-d): pH 6.5 to 8.5, read to two decimals;
// turbidity over 250 NTU
export const NAL = { ph_low: 6.5, ph_high: 8.5, ntu: 250 };
