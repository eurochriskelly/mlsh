.DEFAULT_GOAL := help

.PHONY: help install link run test

help:
	@printf '%s\n' \
	  'MLSH checkout setup' \
	  '' \
	  'Prerequisite: Node.js 18 or later' \
	  '' \
	  'Getting started from this checkout:' \
	  '  make install    Install project dependencies' \
	  '  make link       Make the mlsh command available globally' \
	  '  mlsh env        Create or migrate your first environment' \
	  '' \
	  'Other commands:' \
	  '  make run        Show mlsh help without linking globally' \
	  '  make test       Run the test suite'

install:
	npm install

link: install
	npm link

run:
	node bin/mlsh help

test:
	npm test
