<template>
  <ChapterPage ref="chapter" :chapter-id="organizationId" section-view="contact" />
</template>

<script>
import ChapterPage from '../../components/ChapterPage.vue'
import { chapterPageRoute } from '../../utils/chapterPageRoute'

export default {
  components: { ChapterPage },
  mixins: [chapterPageRoute]
}
</script>
