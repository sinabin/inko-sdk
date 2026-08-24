<script lang="ts">
  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import PdfThumbnail from '../../../src/components/PdfThumbnail.svelte'

  interface Props {
    initialDocument: PDFDocumentProxy
    pageNumber?: number
  }

  let { initialDocument, pageNumber = 1 }: Props = $props()
  let replacementDocument = $state<PDFDocumentProxy | null>(null)
  let pdfDocument = $derived(replacementDocument ?? initialDocument)

  export function setPdfDocument(nextDocument: PDFDocumentProxy): void {
    replacementDocument = nextDocument
  }
</script>

<PdfThumbnail {pdfDocument} {pageNumber} isActive={false} />
