<script setup>
import {computed} from 'vue';
import AppIcon from '../components/AppIcon.vue';

const props = defineProps({kind: {type: String, required: true}, items: {type: Array, default: () => []}});
const emit = defineEmits(['navigate', 'remove', 'clear']);
const isBookmarks = computed(() => props.kind === 'bookmarks');
const dateFormat = new Intl.DateTimeFormat('zh-CN', {month: 'short', day: 'numeric', timeZone: 'Asia/Shanghai'});
</script>

<template>
  <section :id="`${kind}-panel`" class="panel list-panel" :aria-labelledby="`${kind}-title`">
    <div class="panel-heading">
      <div><span class="eyebrow">{{ isBookmarks ? 'SAVED FOR LATER' : 'YOUR FOOTPRINTS' }}</span>
        <h1 :id="`${kind}-title`">{{ isBookmarks ? '我的收藏' : '最近访问' }}</h1>
        <p>{{ isBookmarks ? '喜欢的网页，下次接着看。' : '记录每一次小小的探索。' }}</p>
      </div>
      <span v-if="isBookmarks" id="bookmark-count" class="count-label">{{ items.length }} 个网页</span>
      <button v-else id="clear-history" class="subtle-button" :disabled="!items.length" @click="emit('clear')"><AppIcon name="trash" />清空记录</button>
    </div>
    <div :id="`${kind}-list`" class="saved-list">
      <div v-if="!items.length" class="empty-state">
        <AppIcon :name="isBookmarks ? 'bookmark' : 'history'" />
        <strong>{{ isBookmarks ? '把喜欢的网页留在这里' : '还没有访问记录' }}</strong>
        <p>{{ isBookmarks ? '打开网页，点击顶部的星形按钮，或按 Ctrl+D。' : '从首页打开一个网站，浏览记录就会出现在这里。' }}</p>
      </div>
      <div v-for="item in items" :key="item.url" class="saved-row">
        <button class="saved-open" :title="item.url" @click="emit('navigate', item.url)">
          <span class="site-mark"><AppIcon name="globe" /></span>
          <span class="saved-copy"><strong>{{ item.title || item.url }}</strong><small>{{ item.url }}</small></span>
        </button>
        <button v-if="isBookmarks" class="icon-button" title="取消收藏" :aria-label="`取消收藏 ${item.title}`" @click="emit('remove', item.url)"><AppIcon name="close" /></button>
        <span v-else class="saved-time">{{ dateFormat.format(item.at) }}</span>
      </div>
    </div>
  </section>
</template>
