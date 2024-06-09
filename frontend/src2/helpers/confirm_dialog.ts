import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { VNode, h, ref } from 'vue'

export const dialogs = ref<VNode[]>([])

export function confirmDialog({
	title = 'Untitled',
	message = '',
	fields = [],
	onSuccess = () => {},
}) {
	const component = h(ConfirmDialog, {
		title,
		message,
		fields,
		onSuccess,
	})
	dialogs.value.push(component)
}
