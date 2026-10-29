/** What each agent tool does, in plain words (shown in the log and the control room). */
export const TOOL_LABEL: Record<string, string> = {
  get_overview: 'Reads what the utility knows',
  get_evidence: 'Reviews the evidence so far',
  infer_tree: 'Builds a candidate topology',
  check_hypothesis: 'Checks a hypothesis against the physics',
  compare_hypotheses: 'Looks for the experiment that separates two hypotheses',
  request_review: 'Asks Muse Wonder for a second opinion',
  suggest_experiments: 'Ranks the most informative next experiments',
  passive_correlation: 'Traditional AI: clusters 24 h meter correlations into feeders and a tree',
  geographic_prior: 'Geography: builds a prior from GIS blocks and voltages',
  consensus: 'Ensemble: compares physics, correlation, geography and Meta AI',
  meta_inference: 'Asks Muse Wonder to infer the topology from the raw data',
  run_experiments: 'Runs a batch of experiments',
  dispatch_crew: 'Sends a field crew',
}
