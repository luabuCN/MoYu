<script setup>
import {computed} from 'vue';
import {SelectRoot, SelectTrigger, SelectValue, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText, SelectItemIndicator, SelectScrollUpButton, SelectScrollDownButton} from 'reka-ui';
import AppIcon from './AppIcon.vue';

defineOptions({inheritAttrs: false});
const props = defineProps({modelValue: {type: String, default: ''}, options: {type: Array, required: true}, label: {type: String, required: true}, disabled: Boolean, id: String, paper: String});
const emit = defineEmits(['update:modelValue']);
// Reka reserves an empty value for its placeholder; callers can still use '' for “all”.
const value = computed(() => props.modelValue || '__all__');
</script>

<template>
  <SelectRoot :model-value="value" :disabled="disabled" @update:model-value="emit('update:modelValue', $event === '__all__' ? '' : $event)">
    <SelectTrigger :id="id" class="ui-select-trigger" v-bind="$attrs" :aria-label="label">
      <SelectValue /><AppIcon name="chevron-down" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="ui-select-content" :data-paper="paper" position="popper" :side-offset="6" :collision-padding="12" :body-lock="false">
        <SelectScrollUpButton class="ui-select-scroll"><AppIcon name="chevron-up" /></SelectScrollUpButton>
        <SelectViewport class="ui-select-viewport">
          <SelectItem v-for="option in options" :key="option.value" class="ui-select-item" :value="option.value || '__all__'" :disabled="option.disabled">
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator><AppIcon name="check" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
        <SelectScrollDownButton class="ui-select-scroll"><AppIcon name="chevron-down" /></SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
