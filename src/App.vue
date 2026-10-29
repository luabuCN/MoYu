<script setup>
import {nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import IconDefs from './components/IconDefs.vue';
import AppIcon from './components/AppIcon.vue';
import TitleBar from './components/TitleBar.vue';
import HomeView from './views/HomeView.vue';
import SavedPagesView from './views/SavedPagesView.vue';
import SettingsView from './views/SettingsView.vue';
import ReaderView from './views/ReaderView.vue';
import {useMoyu} from './composables/useMoyu.js';

const {state, toast, action, showToast, bridge} = useMoyu();
const home = ref();
const toolbar = ref();
const clearDialog = ref();
const cancelClear = ref();
let unsubscribeFocus;
let unsubscribeToolbar;

const showPanel = panel => action('panel', panel);
async function openUrl(url) {
  if (await action('navigate', url)) home.value?.clearAddress();
}
function confirmClear() {
  clearDialog.value.showModal();
  cancelClear.value.focus();
}
async function clearHistory() {
  clearDialog.value.close();
  if (await action('clear-history')) showToast('访问历史已清空');
}

watch(() => state.value.panel, async panel => {
  await nextTick();
  if (panel !== 'web') document.getElementById(`${panel}-panel`)?.scrollTo({top: 0});
  if (document.activeElement?.closest('main .panel[hidden]')) document.activeElement.blur();
});

onMounted(() => {
  unsubscribeToolbar = bridge?.onFocusToolbar?.(async () => {
    await nextTick();
    toolbar.value?.focus();
  });
  unsubscribeFocus = bridge?.onFocusAddress(async () => {
    await showPanel('home');
    await nextTick();
    await home.value?.focusAddress(state.value.url);
  });
});
onUnmounted(() => { unsubscribeFocus?.(); unsubscribeToolbar?.(); });
</script>

<template>
  <IconDefs />
  <TitleBar ref="toolbar" :state="state" @action="action" @panel="showPanel" />
  <main id="workspace" :style="{top: state.toolbarVisible ? '38px' : '0px'}">
    <HomeView ref="home" :state="state" :hidden="state.panel !== 'home'" @navigate="openUrl" @panel="showPanel" />
    <section id="web-panel" class="panel web-panel" :hidden="state.panel !== 'web'" aria-label="网页内容">
      <div id="web-message" class="web-message" :hidden="!state.error"><AppIcon name="globe" /><h1>暂时没有连接上</h1><p id="web-error">{{ state.error }}</p>
        <button class="primary-button" @click="action('reload')">重新加载</button><button class="text-button" @click="showPanel('home')">返回首页</button>
      </div>
    </section>
    <SavedPagesView kind="bookmarks" :items="state.bookmarks" :hidden="state.panel !== 'bookmarks'"
      @navigate="openUrl" @remove="url => action('remove-bookmark', url)" />
    <SavedPagesView kind="history" :items="state.history" :hidden="state.panel !== 'history'"
      @navigate="openUrl" @clear="confirmClear" />
    <SettingsView :state="state" :hidden="state.panel !== 'settings'" @action="action" />
    <ReaderView :active="state.panel === 'reader'" :hidden="state.panel !== 'reader'" @toast="showToast" />
  </main>
  <div id="toast" role="status" aria-live="polite" :hidden="!toast">{{ toast }}</div>
  <dialog id="confirm-dialog" ref="clearDialog"><h2>清空访问历史？</h2><p>此操作只清空本机的访问记录，收藏和登录状态会保留。</p>
    <div><button id="cancel-clear" ref="cancelClear" class="subtle-button" @click="clearDialog.close()">取消</button><button id="confirm-clear" class="primary-button" @click="clearHistory">清空记录</button></div>
  </dialog>
</template>

<style>
#app { width: 100%; height: 100%; overflow: hidden; }
</style>
