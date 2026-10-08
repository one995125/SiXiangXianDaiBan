import { RecordOrderAction } from '../services/record-service'

export interface RecordOrderMenuItem {
  label: string
  action: RecordOrderAction
}

/**
 * 根据事项在当前列表中的位置生成长按排序菜单。
 *
 * 参数 recordIndex：事项下标；recordCount：同类事项总数。
 * 注意：相邻移动已经能到达边界时，不再重复显示“移到最前/最后”。
 */
export function buildRecordOrderMenu(recordIndex: number, recordCount: number): RecordOrderMenuItem[] {
  const menuItems: RecordOrderMenuItem[] = []

  if (recordIndex > 0) {
    menuItems.push({ label: '上移一位', action: 'up' })
  }

  if (recordIndex < recordCount - 1) {
    menuItems.push({ label: '下移一位', action: 'down' })
  }

  if (recordIndex > 1) {
    menuItems.push({ label: '移到最前', action: 'first' })
  }

  if (recordIndex < recordCount - 2) {
    menuItems.push({ label: '移到最后', action: 'last' })
  }

  return menuItems
}
