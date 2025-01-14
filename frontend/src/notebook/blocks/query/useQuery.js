import useChart from '@/query/useChart'
import { useQueryResource } from '@/query/useQueryResource'
import sessionStore from '@/stores/sessionStore'
import { safeJSONParse } from '@/utils'
import { getFormattedResult } from '@/utils/query/results'
import { watchDebounced, watchOnce } from '@vueuse/core'
import { call, debounce } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

const session = sessionStore()

const queries = {}

export default function useQuery(name) {
	if (!queries[name]) {
		queries[name] = makeQuery(name)
	}
	return queries[name]
}

function makeQuery(name) {
	const resource = useQueryResource(name)
	const state = reactive({
		autosave: false,
		loading: true,
		executing: false,
		error: null,
		isOwner: false,
		doc: {},
		chart: {},
		sourceSchema: [],
		formattedResults: [],
		resultColumns: [],
	})

	state.reload = async () => {
		return resource.get.fetch().then(() => state.syncDoc())
	}

	state.syncDoc = async function () {
		state.doc = { ...resource.doc }
		state.isOwner = state.doc.owner == session.user.user_id
		state.loading = false
	}

	state.convertToNative = async function () {
		state.loading = true
		await resource.convert_to_native.submit()
		await state.syncDoc()
		state.loading = false
	}
	state.convertToAssisted = async function () {
		state.loading = true
		await resource.convert_to_assisted.submit()
		await state.syncDoc()
		state.loading = false
	}

	// Results
	state.MAX_ROWS = 100
	state.formattedResults = computed(() =>
		getFormattedResult(state.doc.results.slice(0, state.MAX_ROWS))
	)
	state.resultColumns = computed(() => state.doc.results?.[0])

	state.execute = debounce(async () => {
		state.executing = true
		await state.save()
		await resource.run
			.submit()
			.then(() => state.reload())
			.catch((e) => {
				console.error(e)
			})
		state.executing = false
	}, 300)

	watchOnce(() => state.autosave, setupAutosaveListener)
	function setupAutosaveListener() {
		watchDebounced(
			getUpdatedFields,
			function (newDoc, oldDoc) {
				if (state.executing) return
				if (!oldDoc || !newDoc) return
				if (JSON.stringify(newDoc) == JSON.stringify(oldDoc)) return
				if (state.saving) {
					state.saveWhenSavingIsDone = true
					return
				}
				state.save()
			},
			{ deep: true, debounce: 0 }
		)

		watch(
			() => state.loading,
			(newLoading, oldLoading) => {
				const wasSaving = !newLoading && oldLoading
				if (wasSaving && state.saveWhenSavingIsDone) {
					state.saveWhenSavingIsDone = false
					state.save()
				}
			}
		)
	}

	function getUpdatedFields() {
		if (!state.doc.data_source) return
		const updatedFields = {
			data_source: state.doc.data_source,
			sql: state.doc.sql,
			script: state.doc.script,
			json: JSON.stringify(safeJSONParse(state.doc.json), null, 2),
		}
		return updatedFields
	}

	state.save = async () => {
		state.loading = true
		state.saving = true
		const updatedFields = getUpdatedFields()
		await resource.setValue.submit(updatedFields)
		state.saving = false
		state.loading = false
	}

	state.fetchSourceSchema = async () => {
		if (!state.doc.data_source) return
		state.sourceSchema = await call('insights.api.data_sources.get_source_schema', {
			data_source: state.doc.data_source,
		})
	}

	state.loadChart = async () => {
		const response = await resource.get_chart_name.fetch()
		state.chart = useChart(response.message)
		state.chart.enableAutoSave()
	}

	state.delete = async () => {
		state.deleting = true
		await resource.delete.submit()
		state.deleting = false
	}

	state.getTablesColumns = async () => {
		const response = await resource.get_tables_columns.fetch()
		return response.message
	}

	state.updateDoc = async (doc) => {
		state.loading = true
		await resource.setValue.submit(doc)
		await state.syncDoc()
		state.loading = false
	}

	state.duplicate = async () => {
		state.duplicating = true
		const { message } = await resource.duplicate.submit()
		state.duplicating = false
		return message
	}

	state.saveAsTable = async () => {
		state.loading = true
		await resource.save_as_table.submit()
		await state.syncDoc()
		state.loading = false
	}

	return state
}

function throttle(func, limit) {
	let inThrottle
	return function () {
		const args = arguments
		const context = this
		if (!inThrottle) {
			func.apply(context, args)
			inThrottle = true
			setTimeout(() => (inThrottle = false), limit)
		}
	}
}
