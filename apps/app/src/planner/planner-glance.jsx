// planner-glance.jsx — promoted to @nexusmd/ui (shared with web). Re-exported here
// and re-exposed on window for the app's legacy planner views.
import { glanceCollect, GlanceStat, GlanceView, collectCarryItems, CarryOverModal } from '@nexusmd/ui'

Object.assign(window, { GlanceView, glanceCollect, collectCarryItems, CarryOverModal })

export { GlanceStat, GlanceView, CarryOverModal, glanceCollect, collectCarryItems }
