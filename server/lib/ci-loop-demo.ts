// Throwaway module to exercise the dashboard CI auto-fix loop end-to-end.
// Safe to delete. Contains an intentional off-by-one bug for the test to catch.
export function sumRange(n: number): number {
  let total = 0
  for (let i = 1; i <= n; i++) {
    total += i
  }
  return total
}
