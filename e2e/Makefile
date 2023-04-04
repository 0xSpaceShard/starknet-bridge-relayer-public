include ./e2e.env

e2e-up: e2e-down
	docker compose -f docker-compose-e2e.yaml up

e2e-down:
	docker compose -f docker-compose-e2e.yaml down

e2e-build: e2e-down
	docker compose -f docker-compose-e2e.yaml build

e2e-test-1:
	cd .. && yarn test1:e2e --runInBand

e2e-test-2:
	cd .. && yarn test2:e2e --runInBand

e2e-setup-1:
# restore mongo data
	docker cp data/dump-1 e2e-mongo-1:/dump && \
	docker exec e2e-mongo-1 /bin/bash -c mongorestore --db=starknet_bridge_indexer /dump/starknet_bridge_indexer -v \

e2e-setup-2:
# restore mongo data
	docker cp data/dump-2 e2e-mongo-1:/dump && \
	docker exec e2e-mongo-1 /bin/bash -c mongorestore --db=starknet_bridge_indexer /dump/starknet_bridge_indexer -v \

.PHONY: e2e-up e2e-down e2e-build