export type BookingStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "on_the_way"
  | "in_progress"
  | "completed"
  | "cancelled";

export type BookingRowForRules = {
  status: BookingStatus;
  assigned_driver_id: string | null;
  hasPickupCoords: boolean;
  hasDropoffCoords: boolean;
};

export type ButtonRules = {
  canAssign: boolean;
  canReassign: boolean;
  canCancel: boolean;
  canMarkOnTheWay: boolean;
  canStartTrip: boolean;
  canDropOff: boolean;
  canViewMap: boolean;
};

export type DriverInfo = {
  driver_id: string;
  full_name?: string | null;
  town?: string | null;
  vehicle_type?: string | null;
  plate_number?: string | null;
};

export type DriverMap = Map<string, DriverInfo>;

export function buildDriverMap(drivers: DriverInfo[]): DriverMap {
  const map = new Map<string, DriverInfo>();
  for (const d of drivers) {
    if (d.driver_id) {
      map.set(d.driver_id, d);
    }
  }
  return map;
}

export function buildDriverLabel(
  assigned_driver_id: string | null,
  driversById: DriverMap
): string {
  if (!assigned_driver_id) return "Unassigned";

  const info = driversById.get(assigned_driver_id);
  if (!info) {
    return assigned_driver_id;
  }

  const titleParts: string[] = [];

  if (info.full_name) {
    titleParts.push(info.full_name);
  }

  if (info.town) {
    titleParts.push(info.town);
  }

  if (info.vehicle_type || info.plate_number) {
    const vehicleBits = [
      info.vehicle_type || undefined,
      info.plate_number || undefined,
    ].filter(Boolean);
    if (vehicleBits.length > 0) {
      titleParts.push(vehicleBits.join(" • "));
    }
  }

  const main = titleParts.join(" – ");

  if (info.driver_id) {
    if (main) return `${main} (${info.driver_id})`;
    return info.driver_id;
  }

  return main || "Unknown driver";
}

export function getButtonRules(row: BookingRowForRules): ButtonRules {
  const { status, assigned_driver_id } = row;

  const isAssigned = !!assigned_driver_id;

  const rules: ButtonRules = {
    canAssign: false,
    canReassign: false,
    canCancel: false,
    canMarkOnTheWay: false,
    canStartTrip: false,
    canDropOff: false,
    // TEMP: always allow map for now so you can open the map page
    canViewMap: true,
  };

  switch (status) {
    case "pending": {
      rules.canAssign = !isAssigned;
      rules.canCancel = true;
      break;
    }

    case "assigned": {
      rules.canAssign = false;
      rules.canReassign = isAssigned;
      rules.canCancel = true;
      rules.canMarkOnTheWay = isAssigned;
      break;
    }

    case "accepted":
    case "on_the_way": {
      rules.canAssign = false;
      rules.canReassign = isAssigned;
      rules.canCancel = true;
      rules.canMarkOnTheWay = false;
      rules.canStartTrip = isAssigned;
      break;
    }

    case "in_progress": {
      rules.canAssign = false;
      rules.canReassign = false;
      rules.canCancel = false;
      rules.canStartTrip = false;
      rules.canDropOff = isAssigned;
      break;
    }

    case "completed":
    case "cancelled": {
      break;
    }

    default: {
      break;
    }
  }

  return rules;
}
