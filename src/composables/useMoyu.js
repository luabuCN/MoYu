import {onMounted, onUnmounted, ref, shallowRef, watch} from 'vue';

const initialState = {
  panel: 'home', hidden: false, url: '', title: '', loading: false, error: '',
  hasPage: false, lastUrl: '', canBack: false, canForward: false, bookmarked: false,
  webFullscreen: false,
  toolbarAutoHide: false, toolbarVisible: true,
  opacity: 1, zoom: 1, pinned: false, mobile: false, theme: 'light',
  pauseOnHide: true, hoverHide: false, edgeHide: false, bookmarks: [], history: [],
  hoverHideDelayMs: 1000, hoverHideDistance: 100, outsideClickStatus: 'stopped',
  shortcutAvailable: true, notice: '', version: '',
};

export function useMoyu() {
  const state = shallowRef({...initialState});
  const toast = ref('');
  const bridge = window.moyu;
  let timer;
  let unsubscribe;
  let revision = 0;
  let disposed = false;

  function showToast(message) {
    if (disposed) return;
    toast.value = message;
    clearTimeout(timer);
    timer = setTimeout(() => { toast.value = ''; }, 3200);
  }

  function receive(next) {
    if (disposed) return;
    revision++;
    state.value = {...initialState, ...next};
  }

  async function action(name, value) {
    try {
      if (!bridge) throw new Error('请通过 Electron 启动应用');
      const reply = await bridge.action(name, value);
      if (!reply.ok) throw new Error(reply.error);
      if (name === 'bookmark') showToast(reply.result.bookmarked ? '已加入收藏' : '已取消收藏');
      if (name === 'remove-bookmark') showToast('已取消收藏');
      if (name === 'close-page') showToast('网页已关闭');
      return reply.result;
    } catch (error) {
      showToast(error.message);
      return null;
    }
  }

  watch(() => state.value.theme, theme => { document.documentElement.dataset.theme = theme; }, {immediate: true});
  watch(() => state.value.panel, panel => { document.body.dataset.panel = panel; }, {immediate: true});
  watch(() => state.value.notice, notice => { if (notice) showToast(notice); });

  onMounted(async () => {
    if (!bridge) { showToast('请运行 npm run dev 或使用桌面启动入口'); return; }
    unsubscribe = bridge.onState(receive);
    const beforeRequest = revision;
    try {
      const next = await bridge.getState();
      if (revision === beforeRequest) receive(next);
    } catch (error) { showToast(error.message); }
  });

  onUnmounted(() => {
    disposed = true;
    unsubscribe?.();
    clearTimeout(timer);
  });

  return {state, toast, action, showToast, bridge};
}
