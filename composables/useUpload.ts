import { Sema } from 'async-sema'
import { FetchError } from "ofetch"
import type { Entry } from '@zip.js/zip.js'
import { WORKSPACE_COLLECTIONS } from '~~/shared/workspaceCollections'

const MAX_BATCH_BYTES = 750 * 1024
const encoder = new TextEncoder()

const splitIntoBatches = (data: any[]) => {
  const batches: any[][] = []
  let batch: any[] = []
  let batchBytes = 11 // {"data":[]}

  for (const entry of data) {
    const entryBytes = encoder.encode(JSON.stringify(entry)).length
    const separatorBytes = batch.length > 0 ? 1 : 0

    if (batch.length > 0 && batchBytes + separatorBytes + entryBytes > MAX_BATCH_BYTES) {
      batches.push(batch)
      batch = []
      batchBytes = 11
    }

    batch.push(entry)
    batchBytes += (batch.length > 1 ? 1 : 0) + entryBytes
  }

  if (batch.length > 0)
    batches.push(batch)

  return batches
}

export const useUpload = () => {
  const queue = ref(new Set<string>())
  const done = ref(new Set<string>())
  const errors = ref(new Set<string>())
  const retriable = ref(false)
  const full = ref(false)

  const { parseData } = useZip()

  const list = ref<HTMLElement>()

  const sema = new Sema(3)

  const uploadChannel = async (channel: string, entries: Entry[]) => {
    try {
      await sema.acquire()
      queue.value.add(channel)
      const channelEntries = entries.filter(
        e => !e.directory && e.filename.startsWith(`${channel}/`),
      )

      const data = await parseData(channelEntries)

      for (const batch of splitIntoBatches(data)) {
        await $fetch(`/api/import/channel/${channel}`, {
          method: 'POST',
          body: { data: batch },
        })
      }

      done.value.add(channel)
    }
    catch (e) {
      errors.value.add(channel)
    }
    finally {
      queue.value.delete(channel)
      sema.release()
    }
  }

  const uploadWorkspaceData = async (channels: string[], entries: Entry[]) => {
    try {
      queue.value.add('vuesualizer-workspace')
      const workspaceEntries = entries.filter(
        e => !e.directory && WORKSPACE_COLLECTIONS.some(name => e.filename === `${name}.json`),
      )
      let data = await Promise.all(
        workspaceEntries.map(async e => ({
          name: e.filename.split('.json')[0],
          data: await parseData([e]),
        })),
      )

      // remove channels that are not to be imported
      data = data.map((d) => {
        if (d.name !== 'channels')
          return d

        d.data = d.data.filter(c => channels.includes(c.name))
        return d
      })

      // guard against empty datasets
      data = data.filter(d => !(d.data.length === 1 && d.data[0] === ''))

      await $fetch('/api/import/workspace', {
        method: 'POST',
        body: { data: [] },
      })

      for (const dataset of data) {
        for (const batch of splitIntoBatches(dataset.data)) {
          await $fetch(`/api/import/workspace/${dataset.name}`, {
            method: 'POST',
            body: { data: batch },
          })
        }
      }

      done.value.add('vuesualizer-workspace')
    }
    catch (e) {
      errors.value.add('vuesualizer-workspace')

      if (e instanceof FetchError && e.response?.status === 409) {
        full.value = true
      }

      throw e
    }
    finally {
      queue.value.delete('vuesualizer-workspace')
    }
  }

  const doUpload = async (channels: string[], entries: Entry[]) => {
    retriable.value = false

    if (!done.value.has('vuesualizer-workspace'))
      await uploadWorkspaceData(channels, entries)

    const channelsToUpload = channels.filter(
      channel => !done.value.has(channel),
    )

    await Promise.all(channelsToUpload.map(channel => uploadChannel(channel, entries)))

    if (done.value.size === channels.length + 1)
      return true

    retriable.value = true
    return false
  }

  return {
    queue,
    done,
    errors,
    full,
    retriable,
    list,
    doUpload,
  }
}
