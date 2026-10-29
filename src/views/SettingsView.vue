<script setup>
import {ref, watch} from 'vue';
import AppIcon from '../components/AppIcon.vue';
import UiSlider from '../components/UiSlider.vue';

const props = defineProps({state: {type: Object, required: true}});
const emit = defineEmits(['action']);
const opacity = ref(100);
const zoom = ref(100);
const hoverHideDelay = ref('1');
const hoverHideDelayError = ref('');
watch(() => props.state.hoverHideDelayMs, value => {
  if (document.activeElement?.id !== 'hover-hide-delay') hoverHideDelay.value = String(value / 1000);
}, {immediate: true});
function saveHoverHideDelay() {
  const seconds = Number(hoverHideDelay.value);
  const milliseconds = Math.round(seconds * 1000);
  if (!hoverHideDelay.value.trim() || !Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(milliseconds)) {
    hoverHideDelayError.value = '请输入大于或等于 0 的有效秒数';
    return;
  }
  hoverHideDelayError.value = '';
  hoverHideDelay.value = String(milliseconds / 1000);
  if (milliseconds !== props.state.hoverHideDelayMs) emit('action', 'hover-hide-delay', milliseconds);
}
watch(() => props.state.opacity, value => {
  if (document.activeElement?.id !== 'opacity') opacity.value = Math.round(value * 100);
}, {immediate: true});
watch(() => props.state.zoom, value => {
  if (document.activeElement?.id !== 'zoom') zoom.value = Math.round(value * 100);
}, {immediate: true});
</script>

<template>
  <section id="settings-panel" class="panel settings-panel" aria-labelledby="settings-title">
    <div class="panel-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h1 id="settings-title">小窗设置</h1><p>让它更适合你的使用习惯。</p></div>
      <button id="theme-toggle" class="icon-button" title="切换深浅主题" aria-label="切换深浅主题" @click="emit('action', 'theme')"><AppIcon :name="state.theme === 'light' ? 'moon' : 'sun'" /></button>
    </div>
    <div class="settings-card">
      <label class="switch-setting"><span><strong>自动隐藏顶部工具栏</strong><small>鼠标移到窗口顶部显示，移开后收起，让网页占满窗口</small><small>也可按 F6 展开工具栏，按 Esc 收起</small></span>
        <input id="toolbar-auto-hide-setting" type="checkbox" role="switch" :checked="state.toolbarAutoHide" @change="emit('action', 'toolbar-auto-hide', $event.target.checked)"><span class="switch-track" aria-hidden="true"></span>
      </label>
      <label class="switch-setting"><span><strong>鼠标移出收进托盘</strong><small>离开窗口超过 100 像素，停留 {{ state.hoverHideDelayMs / 1000 }} 秒后收起；在窗口外点击立即收起</small><small>移回缓冲区取消计时，收起后点击托盘图标恢复</small></span>
        <input id="hover-hide-setting" type="checkbox" role="switch" :checked="state.hoverHide" @change="emit('action', 'hover-hide', $event.target.checked)"><span class="switch-track" aria-hidden="true"></span>
      </label>
      <div class="delay-setting">
        <div><label for="hover-hide-delay"><strong>移出隐藏延迟</strong></label><small id="hover-hide-delay-hint">默认 1 秒，支持小数；0 秒表示立即收起。按回车或移开焦点自动保存。</small><small v-if="hoverHideDelayError" id="hover-hide-delay-error" class="delay-error" role="alert">{{ hoverHideDelayError }}</small></div>
        <div class="delay-input"><input id="hover-hide-delay" type="number" min="0" step="any" inputmode="decimal" :value="hoverHideDelay" :aria-invalid="Boolean(hoverHideDelayError)" :aria-describedby="hoverHideDelayError ? 'hover-hide-delay-hint hover-hide-delay-error' : 'hover-hide-delay-hint'" @input="hoverHideDelay = $event.target.value; hoverHideDelayError = ''" @blur="saveHoverHideDelay" @keydown.enter.prevent="$event.target.blur()"><span aria-hidden="true">秒</span></div>
      </div>
      <label class="switch-setting"><span><strong>启用侧边收起</strong><small>开启后显示顶部收起按钮，收起后在屏幕右侧恢复</small></span>
        <input id="edge-hide-setting" type="checkbox" role="switch" :checked="state.edgeHide" @change="emit('action', 'edge-hide', $event.target.checked)"><span class="switch-track" aria-hidden="true"></span>
      </label>
      <div class="range-setting"><span><strong>窗口透明度</strong><small>整个窗口一起变淡</small></span>
        <div><UiSlider id="opacity" v-model="opacity" label="窗口透明度" :min="30" :max="100" :step="5" @commit="emit('action', 'opacity', $event / 100)" /><output id="opacity-value" for="opacity">{{ opacity }}%</output></div>
      </div>
      <div class="range-setting"><span><strong>网页缩放</strong><small>调整网页内容大小</small></span>
        <div><UiSlider id="zoom" v-model="zoom" label="网页缩放" :min="50" :max="200" :step="10" @commit="emit('action', 'zoom', $event / 100)" /><output id="zoom-value" for="zoom">{{ zoom }}%</output></div>
      </div>
      <label class="switch-setting"><span><strong>窗口置顶</strong><small>浏览其他应用时，小窗仍在前面</small></span>
        <input id="pinned-setting" type="checkbox" role="switch" :checked="state.pinned" @change="emit('action', 'pin')"><span class="switch-track" aria-hidden="true"></span>
      </label>
      <label class="switch-setting"><span><strong>手机模式</strong><small>以手机身份访问，切换后刷新网页</small></span>
        <input id="mobile-setting" type="checkbox" role="switch" :checked="state.mobile" @change="emit('action', 'mobile')"><span class="switch-track" aria-hidden="true"></span>
      </label>
      <label class="switch-setting"><span><strong>收起时暂停媒体</strong><small>隐藏、最小化或离开网页时暂停，返回后恢复</small></span>
        <input id="pause-setting" type="checkbox" role="switch" :checked="state.pauseOnHide" @change="emit('action', 'pause-on-hide', $event.target.checked)"><span class="switch-track" aria-hidden="true"></span>
      </label>
    </div>
    <p v-if="state.hoverHide && state.outsideClickStatus === 'failed'" class="settings-note danger-text" role="status">外部点击监听暂未启动，距离和延迟收起仍可用；请退出并重启应用。</p>
    <div class="settings-note"><AppIcon name="link" /><p>应用只在系统托盘保留图标，不显示任务栏按钮。点击托盘图标可恢复窗口。登录状态、收藏和设置均保存在本机。</p></div>
    <div class="settings-shortcut"><span>显示 / 隐藏窗口</span><kbd>Ctrl + Shift + Space</kbd><small id="shortcut-warning" :hidden="state.shortcutAvailable">快捷键被占用，可点击系统托盘恢复。</small></div>
    <div class="settings-footer"><span id="version-label">沫鱼 · MoYu {{ state.version }}</span><button class="text-button danger-text" @click="emit('action', 'quit')">退出程序</button></div>
  </section>
</template>
