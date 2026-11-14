import { Dashboard, DetailReturn } from './dashboard.js';
import { installPanel } from '../src/dag_run/tui-controller.js';
export default { id: 'static-dag.panel', async tui(api) { await installPanel(api, Dashboard, DetailReturn); } };
