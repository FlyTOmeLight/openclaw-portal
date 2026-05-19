<template>
  <ConfirmDialog
    :show="confirmState.show"
    :title="confirmState.title"
    :message="confirmState.message"
    :confirm-text="confirmState.confirmText"
    :cancel-text="confirmState.cancelText"
    :danger="confirmState.danger"
    @confirm="settleConfirm(true)"
    @cancel="settleConfirm(false)"
  />
</template>

<script setup lang="ts">
import ConfirmDialog from './ConfirmDialog.vue'
import { confirmState, settleConfirm } from '../composables/useConfirm.js'
</script>
