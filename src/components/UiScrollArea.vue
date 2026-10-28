<script setup>
import {ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb} from 'reka-ui';
defineProps({label: {type: String, default: '可滚动内容'}});
</script>

<template>
  <ScrollAreaRoot class="ui-scroll-area" type="auto">
    <ScrollAreaViewport class="ui-scroll-viewport" tabindex="0" :aria-label="label"><slot /></ScrollAreaViewport>
    <ScrollAreaScrollbar class="ui-scrollbar" orientation="vertical"><ScrollAreaThumb class="ui-scroll-thumb" /></ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>
