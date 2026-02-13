-- ===============================
-- Sample Test Data
-- ===============================

-- Passengers
INSERT INTO passengers (name, phone, email) VALUES
('Juan Dela Cruz', '09171234567', 'juan@example.com'),
('Maria Clara', '09181234567', 'maria@example.com');

-- Drivers
INSERT INTO drivers (name, phone, vehicle_type, plate_number) VALUES
('Pedro Santos', '09191234567', 'tricycle', 'ABC123'),
('Jose Rizal', '09201234567', 'motorcycle', 'XYZ456');

-- Ride Requests
INSERT INTO rides (passenger_id, pickup_point, dropoff_point)
VALUES
((SELECT id FROM passengers WHERE name='Juan Dela Cruz'), 'Barangay A', 'Barangay B'),
((SELECT id FROM passengers WHERE name='Maria Clara'), 'Barangay C', 'Barangay D');

-- Driver Offers (sample)
INSERT INTO ride_offers (ride_id, driver_id, proposed_fare)
VALUES
((SELECT id FROM rides LIMIT 1), (SELECT id FROM drivers WHERE name='Pedro Santos'), 50);
