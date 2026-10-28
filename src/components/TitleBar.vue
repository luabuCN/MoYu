<script setup>
import AppIcon from './AppIcon.vue';
import BrandLogo from './BrandLogo.vue';

defineProps({state: {type: Object, required: true}});
const emit = defineEmits(['action', 'panel']);
const preview = Boolean(window.moyu?.preview);
</script>

<template>
  <header class="titlebar">
    <nav class="top-navigation" aria-label="网页导航">
      <button class="icon-button" data-panel="home" title="首页 · 输入网址" aria-label="首页"
        :aria-current="state.panel === 'home' ? 'page' : undefined" @click="emit('panel', 'home')"><AppIcon name="home" /></button>
      <button class="icon-button" data-panel="reader" title="阅读器 · 我的书架" aria-label="阅读器"
        :aria-current="state.panel === 'reader' ? 'page' : undefined" @click="emit('panel', 'reader')"><AppIcon name="book" /></button>
      <button class="icon-button" data-panel="bookmarks" title="收藏夹" aria-label="收藏夹"
        :aria-current="state.panel === 'bookmarks' ? 'page' : undefined" @click="emit('panel', 'bookmarks')"><AppIcon name="bookmark" /></button>
      <button id="back" class="icon-button" :hidden="state.panel === 'reader'" title="后退 · Alt+←" aria-label="后退" :disabled="!state.canBack" @click="emit('action', 'back')"><AppIcon name="back" /></button>
      <button id="forward" class="icon-button" :hidden="state.panel === 'reader'" title="前进 · Alt+→" aria-label="前进" :disabled="!state.canForward" @click="emit('action', 'forward')"><AppIcon name="arrow" /></button>
      <button id="reload" class="icon-button" :hidden="state.panel === 'reader'" title="重新加载 · F5" aria-label="重新加载" :disabled="!state.hasPage" @click="emit('action', 'reload')"><AppIcon name="reload" /></button>
    </nav>
    <span class="title-spacer"><BrandLogo /><span>{{ preview ? '沫鱼 · 交互预览（示例数据）' : '沫鱼' }}</span></span>
    <div class="window-actions">
      <button id="bookmark" class="icon-button" :hidden="state.panel !== 'web'" :aria-pressed="state.bookmarked"
        :title="state.bookmarked ? '取消收藏 · Ctrl+D' : '收藏当前网页 · Ctrl+D'"
        :aria-label="state.bookmarked ? '取消收藏当前网页' : '收藏当前网页'" @click="emit('action', 'bookmark')"><AppIcon name="star" /></button>
      <button id="resume-button" class="icon-button" data-panel="web" title="继续浏览" aria-label="继续浏览"
        :hidden="state.panel === 'web' || !state.hasPage" @click="emit('panel', 'web')"><AppIcon name="globe" /></button>
      <button id="close-page" class="icon-button page-close" title="关闭网页并停止播放 · Ctrl+W" aria-label="关闭网页"
        :hidden="!state.hasPage" @click="emit('action', 'close-page')"><AppIcon name="page-close" /><span class="page-close-label">关闭网页</span></button>
      <button class="icon-button" data-panel="history" title="历史 · Ctrl+H" aria-label="历史"
        :aria-current="state.panel === 'history' ? 'page' : undefined" @click="emit('panel', 'history')"><AppIcon name="history" /></button>
      <button id="quick-settings" class="icon-button" title="设置" aria-label="设置" @click="emit('panel', 'settings')"><AppIcon name="sliders" /></button>
      <button id="pin" class="icon-button" :title="state.pinned ? '取消置顶' : '置顶窗口'"
        :aria-label="state.pinned ? '取消置顶' : '置顶窗口'" :aria-pressed="state.pinned" @click="emit('action', 'pin')"><AppIcon name="pin" /></button>
      <button id="edge-hide-button" class="icon-button" title="隐藏到侧边 · Ctrl+Shift+Space" aria-label="隐藏到侧边"
        :hidden="!state.edgeHide" @click="emit('action', 'hide')"><AppIcon name="hide" /></button>
      <button class="icon-button" title="最小化" aria-label="最小化" @click="emit('action', 'minimize')"><AppIcon name="minimize" /></button>
      <button class="icon-button" :title="state.webFullscreen ? '退出窗口内全屏 · Esc' : '最大化或还原'"
        :aria-label="state.webFullscreen ? '退出窗口内全屏' : '最大化或还原'"
        @click="emit('action', state.webFullscreen ? 'exit-fullscreen' : 'maximize')"><AppIcon :name="state.webFullscreen ? 'shrink' : 'expand'" /></button>
      <button class="icon-button window-close" :title="state.edgeHide ? '隐藏到侧边，网页继续保留' : '隐藏到托盘，网页继续保留'"
        :aria-label="state.edgeHide ? '隐藏到侧边' : '隐藏到托盘'" @click="emit('action', 'hide')"><AppIcon name="close" /></button>
    </div>
    <div id="loading-line" :hidden="!state.loading"></div>
  </header>
</template>
