import type { RoomStatuses } from "./types";

export interface OccupancyProvider {
  getRoomStatuses(): Promise<RoomStatuses>;
}

export class MockOccupancyProvider implements OccupancyProvider {
  private readonly snapshots: RoomStatuses[] = [
    {
      "room-l1-ocean": "occupied",
      "room-l1-harbor": "available",
      "room-l1-huddle": "available",
      "room-l1-summit": "offline",
      "room-l2-cedar": "available",
      "room-l2-birch": "occupied",
      "room-l2-pods": "focus",
    },
    {
      "room-l1-ocean": "available",
      "room-l1-harbor": "occupied",
      "room-l1-huddle": "occupied",
      "room-l1-summit": "available",
      "room-l2-cedar": "available",
      "room-l2-birch": "available",
      "room-l2-pods": "focus",
    },
    {
      "room-l1-ocean": "occupied",
      "room-l1-harbor": "available",
      "room-l1-huddle": "available",
      "room-l1-summit": "occupied",
      "room-l2-cedar": "occupied",
      "room-l2-birch": "available",
      "room-l2-pods": "available",
    },
  ];

  private cursor = 0;

  async getRoomStatuses(): Promise<RoomStatuses> {
    await new Promise((resolve) => setTimeout(resolve, 120));

    const snapshot = this.snapshots[this.cursor % this.snapshots.length] ?? this.snapshots[0]!;
    this.cursor += 1;

    return snapshot;
  }
}
