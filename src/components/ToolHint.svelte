<script lang="ts">
  interface Props {
    message: string
    isVisible: boolean
  }

  let { message, isVisible }: Props = $props()
</script>

{#if isVisible}
  <div class="tool-hint" role="status">
    {message}
  </div>
{/if}

<style>
  .tool-hint {
    position: absolute;
    top: var(--space-6);
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-surface-toast);
    color: var(--color-text-inverse);
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-pill);
    font-size: var(--font-size-base);
    white-space: nowrap;
    pointer-events: none;
    z-index: 100;
    animation: fadeInOut var(--motion-toast) var(--ease-in-out) forwards;
  }

  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    10% { opacity: 1; transform: translateX(-50%) translateY(0); }
    80% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  }
</style>
