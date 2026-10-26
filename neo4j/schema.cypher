
CREATE CONSTRAINT assembly_id IF NOT EXISTS
FOR (n:Assembly)
REQUIRE n.assembly_id IS UNIQUE;

CREATE CONSTRAINT part_id IF NOT EXISTS
FOR (n:Part)
REQUIRE n.part_id IS UNIQUE;

CREATE CONSTRAINT partfamily_id IF NOT EXISTS
FOR (n:PartFamily)
REQUIRE n.part_id IS UNIQUE;

CREATE CONSTRAINT drawing_id IF NOT EXISTS
FOR (n:Drawing)
REQUIRE n.drawing_id IS UNIQUE;

CREATE CONSTRAINT feature_id IF NOT EXISTS
FOR (n:Feature)
REQUIRE n.feature_id IS UNIQUE;

CREATE CONSTRAINT measurement_spec_id IF NOT EXISTS
FOR (n:MeasurementSpec)
REQUIRE n.spec_id IS UNIQUE;

CREATE CONSTRAINT interface_id IF NOT EXISTS
FOR (n:Interface)
REQUIRE n.interface_id IS UNIQUE;

CREATE CONSTRAINT error_case_id IF NOT EXISTS
FOR (n:ErrorCase)
REQUIRE n.case_id IS UNIQUE;

CREATE CONSTRAINT error_type_key IF NOT EXISTS
FOR (n:ErrorType)
REQUIRE n.key IS UNIQUE;
