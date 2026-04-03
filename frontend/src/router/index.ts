import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import ModelWizard from '../views/ModelWizard.vue'
import Skills from '../views/Skills.vue'
import Plugins from '../views/Plugins.vue'
import Agents from '../views/Agents.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/models', component: ModelWizard },
    { path: '/skills', component: Skills },
    { path: '/plugins', component: Plugins },
    { path: '/agents', component: Agents },
  ],
})
