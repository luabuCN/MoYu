<script setup>
import {computed, nextTick, ref} from 'vue';
import AppIcon from '../components/AppIcon.vue';
import BrandLogo from '../components/BrandLogo.vue';
import {categories, sites, hostname} from '../data/sites.js';

const props = defineProps({state: {type: Object, required: true}});
const emit = defineEmits(['navigate', 'panel']);
const category = ref('recommend');
const address = ref('');
const addressInput = ref();
const visibleSites = computed(() => sites.filter(site => category.value === 'recommend' ? site.recommended : site.group === category.value));
const lastPage = computed(() => props.state.hasPage
  ? {url: props.state.url, title: props.state.title}
  : props.state.history.find(item => item.url === props.state.lastUrl));
const continueTitle = computed(() => lastPage.value?.title || (props.state.lastUrl ? '继续上次浏览' : '从一个网址开始'));
const continueUrl = computed(() => lastPage.value?.url || props.state.lastUrl);
const today = new Intl.DateTimeFormat('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'}).format(new Date());

function submit(event) {
  emit('navigate', event.currentTarget.elements.namedItem('destination').value);
}
async function focusAddress(value = '') {
  address.value = value;
  await nextTick();
  addressInput.value?.focus();
  addressInput.value?.select();
}
function clearAddress() { address.value = ''; }
defineExpose({focusAddress, clearAddress});
</script>

<template>
  <section id="home-panel" class="panel home-panel" aria-labelledby="home-title">
    <div class="home-masthead"><div class="home-signature"><BrandLogo /><span>沫鱼<span class="signature-divider">/</span><small>忙里冒个泡</small></span></div><span class="home-date">{{ today }}</span></div>
    <header class="start-hero"><div class="home-intro"><span class="home-eyebrow">A LITTLE SPACE, JUST FOR YOU</span><h1 id="home-title">忙里，偷一点<span>闲。</span></h1><p>翻几页书，看看世界。把这一小段时间，留给自己。</p></div><span class="hero-seal" aria-hidden="true"><AppIcon name="sun" /><span>片刻<br>自在</span></span></header>
    <form id="home-form" class="start-search" @submit.prevent="submit">
      <label class="reader-sr-only" for="home-address">输入网址或搜索内容</label>
      <div class="home-search"><AppIcon name="search" />
        <input id="home-address" ref="addressInput" v-model="address" name="destination" type="text"
          placeholder="输入网址，或搜索感兴趣的内容" autocomplete="off" spellcheck="false">
        <button type="submit" class="search-go" title="打开网页" aria-label="打开网页"><span>前往</span><AppIcon name="arrow" /></button>
      </div>
      <span class="search-hint">网址直达，或用必应探索新内容<span><kbd>Ctrl</kbd> <kbd>L</kbd> 随时开始</span></span>
    </form>
    <div class="home-moments">
      <button class="home-library-entry" @click="emit('panel', 'reader')"><span class="moment-copy"><small>给自己一页的时间</small><strong>好故事，接着读。</strong><span>打开我的书架 <AppIcon name="arrow" /></span></span><span class="mini-books" aria-hidden="true"><span>闲</span><span>阅</span><span>读</span></span></button>
      <button id="home-continue" class="continue-card" :disabled="!state.hasPage && !state.lastUrl" :title="continueUrl ? `${state.hasPage ? '继续浏览' : '重新打开'} · ${continueUrl}` : '先打开一个网页'" @click="state.hasPage ? emit('panel', 'web') : emit('navigate', continueUrl)">
        <span class="continue-eyebrow"><AppIcon name="history" />{{ state.hasPage ? '继续浏览' : '上次停留的地方' }}</span><strong id="continue-title">{{ continueTitle }}</strong>
        <span class="continue-bottom"><span id="continue-domain">{{ continueUrl ? hostname(continueUrl) : '打开网页后，会在这里为你保留' }}</span><AppIcon name="arrow" /></span>
      </button>
    </div>
    <section class="sites-section" aria-labelledby="sites-heading">
      <div class="start-section-head"><h2 id="sites-heading">随心逛逛 <span id="site-count">{{ String(visibleSites.length).padStart(2, '0') }}</span></h2>
        <button class="text-button" data-panel="bookmarks" @click="emit('panel', 'bookmarks')">我的收藏 <AppIcon name="arrow" /></button>
      </div>
      <nav id="categories" class="categories" aria-label="站点分类">
        <button v-for="item in categories" :key="item.id" :data-category="item.id"
          :class="{selected: category === item.id}" :aria-pressed="category === item.id" @click="category = item.id">{{ item.label }}</button>
      </nav>
      <div id="sites-grid" class="sites-grid">
        <button v-for="site in visibleSites" :key="site.url" class="site-button" :data-group="site.group"
          :title="`在小窗里打开${site.name}`" @click="emit('navigate', site.url)">
          <span class="site-mark"><AppIcon :name="site.icon" /></span>
          <span class="site-copy"><span class="site-name">{{ site.name }}</span><span class="site-domain">{{ site.description || hostname(site.url) }}</span></span>
          <AppIcon name="arrow" class="site-go" />
        </button>
      </div>
    </section>
    <footer class="start-footer"><p><AppIcon name="hide" />收起后，点击系统托盘图标继续浏览</p>
      <button id="home-hide-mode" data-panel="settings" :data-enabled="state.hoverHide" @click="emit('panel', 'settings')">
        <span class="mode-dot" aria-hidden="true"></span><span id="home-mode-label">{{ state.hoverHide ? '移出收进托盘已开启' : '自动收起未开启' }}</span>
      </button>
    </footer>
  </section>
</template>
