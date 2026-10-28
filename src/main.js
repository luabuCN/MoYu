import {createApp} from 'vue';
import App from './App.vue';
import './styles/base.css';
import './styles/compact.css';
import './styles/home.css';
import './styles/reader.css';
import '../web-scrollbars.css';
import './styles/ui.css';
import './styles/reader-polish.css';

async function mount() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview') && !window.moyu) {
    const {installPreview} = await import('./preview.js');
    installPreview();
  }
  createApp(App).mount('#app');
}
void mount();
