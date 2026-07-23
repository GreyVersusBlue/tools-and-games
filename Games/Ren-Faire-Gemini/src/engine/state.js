export const gameState = {
  day: 1,
  gold: 1000,
  reputation: 50,
  ticketPrice: 15,
  hiredPerformers: [
    { id: 'jester_01', name: 'Milo the Fool', dailyCost: 75, prestige: 12, assignedStage: 'stage_01' }
  ],
  placedVendors: [
    { id: 'turkey_leg_01', name: 'Ye Olde Turkey Leg', dailyFee: 30, cutPercentage: 0.15, slotId: 'vendor_01' }
  ],
  map: {
    width: 5,
    height: 5,
    tiles: [
      { id: 't1', type: 'trees', elevation: 1, shade: true },
      { id: 't2', type: 'clearing', elevation: 0, slotType: 'stage', slotId: 'stage_01' },
      { id: 't3', type: 'path', elevation: 0 },
      { id: 't4', type: 'hill', elevation: 2, slotType: 'vendor', slotId: 'vendor_01' },
      { id: 't5', type: 'trees', elevation: 1, shade: true }
    ]
  }
};