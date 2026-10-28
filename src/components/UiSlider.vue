<script setup>
import {SliderRoot, SliderTrack, SliderRange, SliderThumb} from 'reka-ui';
defineProps({modelValue: {type: Number, required: true}, min: Number, max: Number, step: {type: Number, default: 1}, label: {type: String, required: true}, id: String});
const emit = defineEmits(['update:modelValue', 'commit']);
</script>

<template>
  <SliderRoot class="ui-slider" :model-value="[modelValue]" :min="min" :max="max" :step="step" @update:model-value="emit('update:modelValue', $event[0])" @value-commit="emit('commit', $event[0])">
    <SliderTrack class="ui-slider-track"><SliderRange class="ui-slider-range" /></SliderTrack>
    <SliderThumb :id="id" class="ui-slider-thumb" :aria-label="label" />
  </SliderRoot>
</template>
