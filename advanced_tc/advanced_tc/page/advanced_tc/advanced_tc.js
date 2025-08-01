frappe.pages['advanced_tc'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Advanced Timesheet Calendar',
		single_column: true
	});
	
	// Aggiungi la classe CSS per limitare gli stili a questa pagina
	$(wrapper).addClass('page-advanced_tc');
	
	// Inizializza la calendar view
	new AdvancedTimesheetCalendar(page);
};

class AdvancedTimesheetCalendar {
	constructor(page) {
		this.page = page;
		this.calendar = null;
		this.filters = {};
		this.filter_options = {};
		this.user_permissions = {};
		
		// Carica le impostazioni predefinite dal localStorage
		this.default_settings = this.load_default_settings();
		
		this.setup_page();
		this.load_filter_options();
	}
	
	// Funzione helper per calcolare l'inizio della settimana (lunedì)
	getWeekStartDate(date) {
		const d = new Date(date);
		const day = d.getDay(); // 0=domenica, 1=lunedì, ..., 6=sabato
		// Calcola quanti giorni sottrarre per arrivare al lunedì
		const daysToSubtract = day === 0 ? 6 : day - 1; // Se domenica (0), sottrai 6, altrimenti sottrai (day-1)
		const weekStart = new Date(d);
		weekStart.setDate(d.getDate() - daysToSubtract);
		weekStart.setHours(0, 0, 0, 0); // Reset ore
		return weekStart;
	}
	
	setup_page() {
		// Crea il layout principale con sidebar laterale
		this.page.main.html(`
			<div class="timesheet-calendar-container">
				<div class="row">
					<div class="col-lg-3 col-md-4">
						<div class="calendar-filters-sidebar">
							<h5 class="sidebar-title">Filtri</h5>
							<div class="filter-group">
								<label>Employee</label>
								<select class="form-control" id="employee-filter">
									<option value="">All Employees</option>
								</select>
							</div>
							<div class="filter-group">
								<label>Project</label>
								<select class="form-control" id="project-filter">
									<option value="">All Projects</option>
								</select>
							</div>
							<div class="filter-group">
								<button class="btn btn-success btn-block" id="add-activity">Add Activity</button>
							</div>
							<div class="filter-group">
								<button class="btn btn-info btn-block" id="settings-btn">Settings</button>
							</div>
							<div class="filter-group">
								<button class="btn btn-primary btn-block" id="generate-report-btn">Generate Report</button>
							</div>
						</div>
					</div>
					<div class="col-lg-9 col-md-8">
						<div id="calendar" style="height: 600px;"></div>
					</div>
				</div>
			</div>
		`);
		
		// Setup event listeners
		this.setup_event_listeners();
		
		// Inizializza il calendario
		this.init_calendar();
	}
	
	setup_event_listeners() {
		// Filtri - applicazione automatica
		this.page.main.find('#employee-filter').on('change', () => {
			this.apply_filters();
		});
		
		this.page.main.find('#project-filter').on('change', () => {
			this.apply_filters();
		});
		
		// Aggiungi attività
		this.page.main.find('#add-activity').on('click', () => {
			this.show_activity_dialog();
		});
		
		// Pulsante impostazioni
		this.page.main.find('#settings-btn').on('click', () => {
			this.show_settings_dialog();
		});
		
		// Pulsante generate report
		this.page.main.find('#generate-report-btn').on('click', () => {
			this.show_report_dialog();
		});
	}
	
	init_calendar() {
		// Carica FullCalendar da CDN
		frappe.require([
        'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.global.min.js'
    ], () => {

		if (typeof FullCalendar === 'undefined') {
			return;
		}

		
		this.calendar = new FullCalendar.Calendar(this.page.main.find('#calendar')[0], {
			initialView: 'timeGridWeek',
			timeZone: 'local', // Usa il timezone locale
			locale: 'it', // Imposta la lingua italiana
			firstDay: 1, // Inizia la settimana da lunedì (1) invece di domenica (0)
			allDaySlot: false, // Nasconde la barra "all-day"
			headerToolbar: {
				left: 'prev,next today',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGridDay'
			},
			selectable: true,
			editable: true,
			events: (info, successCallback, failureCallback) => {
				this.load_events(info.start, info.end, successCallback, failureCallback);
			},
			eventClick: (info) => {
				if (this.can_edit_event(info.event)) {
					this.show_activity_dialog(info.event);
				} else {
					frappe.msgprint('Non hai i permessi per modificare questa attività.');
				}
			},
			select: (info) => {
				this.handle_time_selection(info);
			},
			eventDrop: (info) => {
				if (this.can_edit_event(info.event)) {
					this.update_activity(info.event);
				} else {
					info.revert();
					frappe.msgprint('Non hai i permessi per modificare questa attività.');
				}
			},
			eventResize: (info) => {
				if (this.can_edit_event(info.event)) {
					this.update_activity(info.event);
				} else {
					info.revert();
					frappe.msgprint('Non hai i permessi per modificare questa attività.');
				}
			},
			slotMinTime: '06:00:00',
			slotMaxTime: '22:00:00',
			height: 'auto'
		}
	
		);
			
			this.calendar.render();
		});
	}
	
	load_filter_options() {
		frappe.call({
			method: 'advanced_tc.api.timesheet_details.get_filter_options',
			callback: (r) => {
				if (r.message) {
					this.filter_options = r.message;
					this.user_permissions = r.message.user_permissions || {};
					this.populate_filters();
					this.apply_ui_permissions();
				}
			}
		});
	}
	
	populate_filters() {
		// Popola employee filter
		const employeeSelect = this.page.main.find('#employee-filter');
		this.filter_options.employees.forEach(emp => {
			employeeSelect.append(`<option value="${emp.name}">${emp.employee_name}</option>`);
		});
		
		// Popola project filter
		const projectSelect = this.page.main.find('#project-filter');
		
		// Controlla se l'utente è un employee senza progetti assegnati
		if (this.user_permissions && this.user_permissions.is_employee_only && this.filter_options.projects.length === 0) {
			// Mostra messaggio per employee senza progetti
			projectSelect.closest('.filter-group').html(`
				<label>Project</label>
				<div class="alert alert-warning" style="margin-top: 5px; padding: 10px; font-size: 12px;">
					<strong>Nessun progetto assegnato</strong><br>
					Contatta il tuo HR per essere assegnato a un progetto e poter utilizzare l'applicazione.
				</div>
			`);
			
			// Disabilita il pulsante "Add Activity"
			this.page.main.find('#add-activity').prop('disabled', true).text('Nessun progetto disponibile');
		} else {
			// Popola normalmente i progetti
			this.filter_options.projects.forEach(proj => {
				projectSelect.append(`<option value="${proj.name}">${proj.project_name}</option>`);
			});
		}
	}
	
	apply_ui_permissions() {
		try {
			// Verifica se user_permissions è definito e valido
			if (!this.user_permissions || typeof this.user_permissions !== 'object') {
				console.warn('User permissions non disponibili, applicando permessi di default');
				this.user_permissions = {
					is_employee_only: true,
					is_manager: false,
					current_employee: null
				};
			}
			
			// Verifica se l'utente è un Employee semplice
			const isEmployee = this.user_permissions.is_employee_only || false;
			
			if (isEmployee) {
				// Nascondi il filtro employee per gli Employee semplici
				this.page.main.find('#employee-filter').closest('.filter-group').hide();
				
				// Nascondi il pulsante Settings
				this.page.main.find('#settings-btn').hide();
				
				// Non disabilitiamo più l'editable globalmente
				// I controlli di permesso sono gestiti negli event handlers individuali
			}
		} catch (error) {
			console.error('Errore nell\'applicazione dei permessi UI:', error);
			// Applica permessi restrittivi in caso di errore
			this.page.main.find('#employee-filter').closest('.filter-group').hide();
			this.page.main.find('#settings-btn').hide();
			// I controlli di drag and drop sono gestiti negli event handlers
		}
	}
	
	can_edit_event(event) {
		try {
			// Verifica che event e user_permissions siano validi
			if (!event || !event.extendedProps) {
				console.warn('Evento non valido per controllo permessi');
				return false;
			}
			
			if (!this.user_permissions || typeof this.user_permissions !== 'object') {
				console.warn('Permessi utente non disponibili, negando accesso');
				return false;
			}
			
			// Se l'utente non è un Employee semplice, può modificare tutto
			if (!this.user_permissions.is_employee_only) {
				return true;
			}
			
			// Se è un Employee semplice, può modificare solo i propri eventi
			const currentUserEmployee = this.user_permissions.current_employee;
			const eventEmployee = event.extendedProps.employee;
			
			// Verifica che entrambi i valori siano definiti
			if (!currentUserEmployee || !eventEmployee) {
				console.warn('Employee non definito per controllo permessi');
				return false;
			}
			
			return currentUserEmployee === eventEmployee;
		} catch (error) {
			console.error('Errore nel controllo permessi evento:', error);
			return false; // Nega accesso in caso di errore
		}
	}
	
	apply_filters() {
		this.filters = {
			employee: this.page.main.find('#employee-filter').val(),
			project: this.page.main.find('#project-filter').val()
		};
		
		if (this.calendar) {
			this.calendar.refetchEvents();
		}
	}
	
	load_events(start, end, successCallback, failureCallback) {
		frappe.call({
			method: 'advanced_tc.api.timesheet_details.get_timesheet_details',
			args: {
				start_date: start.toISOString(),
				end_date: end.toISOString(),
				filters: JSON.stringify(this.filters)
			},
			callback: (r) => {
				if (r.message) {
					successCallback(r.message);
				} else {
					failureCallback('Error loading events');
				}
			},
			error: (r) => {
				failureCallback('Error loading events');
			}
		});
	}
	
	handle_time_selection(info) {
		// Calcola la durata della selezione in minuti
		const duration = (info.end - info.start) / (1000 * 60);
		
		// Se la selezione è di 30 minuti o meno (tipico di un click singolo),
		// apri il dialog con orari preimpostati per tutta la giornata
		if (duration <= 30) {
			this.show_full_workday_dialog(info.start);
		} else {
			// Altrimenti, usa la selezione manuale
			this.show_activity_dialog(null, info.start, info.end);
		}
	}
	
	show_full_workday_dialog(selected_date) {
		// Utilizza le impostazioni predefinite salvate
		const date = moment(selected_date).format('YYYY-MM-DD');
		
		// Assicurati che le impostazioni siano caricate correttamente
		if (!this.default_settings || !this.default_settings.default_work_start || !this.default_settings.default_work_end) {
			// Ricarica le impostazioni predefinite se non sono disponibili
			this.default_settings = this.load_default_settings();
		}
		
		// Usa valori hardcoded se le impostazioni non sono valide
        const work_start = this.default_settings.default_work_start || '09:30:00';
        const work_end = this.default_settings.default_work_end || '18:30:00';
		
		// Gestisci il formato degli orari - assicurati che siano nel formato HH:MM
		const clean_work_start = work_start.substring(0, 5); // Prendi solo HH:MM
		const clean_work_end = work_end.substring(0, 5); // Prendi solo HH:MM
		
		const start_time = moment(`${date} ${clean_work_start}:00`);
		const end_time = moment(`${date} ${clean_work_end}:00`);
		
		// Apri il dialog con orari preimpostati e pausa pranzo abilitata
		this.show_activity_dialog_with_break(null, start_time.toDate(), end_time.toDate());
	}
	
	show_activity_dialog_with_break(event = null, start_time = null, end_time = null) {
		// Recupera l'employee ID per l'utente corrente
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Employee',
				filters: {
					'user_id': frappe.session.user
				},
				fields: ['name']
			},
			callback: (r) => {
				const employee_id = r.message && r.message.length > 0 ? r.message[0].name : null;
				this.create_dialog_with_break.call(this, event, start_time, end_time, employee_id);
			}
		});
	}
	
	create_dialog_with_break(event, start_time, end_time, employee_id) {
		const is_edit = !!event;
		const event_data = event ? event.extendedProps : {};
		
		// Per l'edit, ottieni start e end dalle proprietà principali dell'evento
		const event_start = event ? event.start : null;
		const event_end = event ? event.end : null;
		
		// Determina se l'utente può selezionare altri employee con controllo errori
		let canSelectEmployee = true;
		let defaultEmployee = event_data.employee || employee_id || this.filters.employee || '';
		
		try {
			if (this.user_permissions && typeof this.user_permissions === 'object') {
				canSelectEmployee = !this.user_permissions.is_employee_only;
				if (this.user_permissions.is_employee_only && this.user_permissions.current_employee) {
					defaultEmployee = this.user_permissions.current_employee;
				}
			} else {
				console.warn('User permissions non disponibili nel dialog, permettendo selezione employee');
			}
		} catch (error) {
			console.error('Errore nel controllo permessi dialog:', error);
		}
		
		const dialog = new frappe.ui.Dialog({
			title: is_edit ? 'Edit Activity' : 'Add New Activity',
			fields: [
				{
			fieldtype: 'Link',
			fieldname: 'employee',
			label: 'Employee',
			options: 'Employee',
			reqd: 1,
			read_only: !canSelectEmployee,
			default: defaultEmployee
		},
			{
			fieldtype: 'Data',
			fieldname: 'timesheet',
			label: 'Timesheet',
			read_only: 1,
			hidden: 1,
			in_list_view: 0,
			print_hide: 1,
			default: event_data.timesheet || ''
		},
				{
					fieldtype: 'Datetime',
					fieldname: 'from_time',
					label: 'From Time',
					reqd: 1,
					default: start_time ? moment(start_time).format('YYYY-MM-DD HH:mm:ss') : 
							 (event_start ? moment(event_start).format('YYYY-MM-DD HH:mm:ss') : '')
				},
				{
					fieldtype: 'Datetime',
					fieldname: 'to_time',
					label: 'To Time',
					reqd: 1,
					default: end_time ? moment(end_time).format('YYYY-MM-DD HH:mm:ss') : 
							 (event_end ? moment(event_end).format('YYYY-MM-DD HH:mm:ss') : '')
				},
				{
					fieldtype: 'Section Break',
					label: 'Break Time (Optional)'
				},
				{
					fieldtype: 'Check',
					fieldname: 'has_break',
					label: 'Has Break Time',
					default: start_time && end_time ? (this.default_settings.auto_enable_break ? 1 : 0) : 0
				},
				{
					fieldtype: 'Time',
					fieldname: 'break_start',
					label: 'Break Start Time',
					depends_on: 'has_break',
					default: start_time && end_time ? this.default_settings.default_break_start : ''
				},
				{
					fieldtype: 'Time',
					fieldname: 'break_end',
					label: 'Break End Time',
					depends_on: 'has_break',
					default: start_time && end_time ? this.default_settings.default_break_end : ''
				},
				{
			fieldtype: 'Link',
			fieldname: 'project',
			label: 'Project',
			options: 'Project',
			default: event_data.project || this.filters.project || '',
			get_query: function() {
				return {
					query: 'advanced_tc.api.timesheet_details.get_employee_projects'
				};
			}
		},
				{
					fieldtype: 'Link',
					fieldname: 'task',
				label: 'Task',
				options: 'Task',
				default: event_data.task,
					get_query: function() {
					const project = dialog.get_value('project');
					const employee = dialog.get_value('employee');
					if (project && employee) {
						return {
							query: 'advanced_tc.api.timesheet_details.get_employee_tasks',
							filters: {
								'project': project,
								'employee': employee
							}
						};
					}
					return {
						filters: {
							'status': ['!=', 'Cancelled']
						}
					};
				},
				onchange: function() {
			const task = dialog.get_value('task');
			const employee = dialog.get_value('employee');
			const currentProject = dialog.get_value('project');
			
			if (task && employee) {
				// Ottieni il progetto della task
				frappe.call({
					method: 'advanced_tc.api.timesheet_details.get_task_project',
					args: { task_name: task },
					callback: (r) => {
						if (r.message) {
							const taskProject = r.message;
							
							// Se il progetto della task è diverso da quello attualmente selezionato
							// verifica se l'employee è assegnato al progetto della task
							if (taskProject !== currentProject) {
								frappe.call({
									method: 'frappe.client.get_list',
									args: {
										doctype: 'ToDo',
										filters: {
											reference_type: 'Project',
											reference_name: taskProject,
											allocated_to: frappe.session.user,
											status: 'Open'
										},
										limit: 1
									},
									callback: (assignment_result) => {
										if (assignment_result.message && assignment_result.message.length > 0) {
							// L'employee è assegnato al progetto, può impostarlo
							projectSetByTask = true;
							dialog.set_value('project', taskProject);
										} else {
											// L'employee non è assegnato al progetto
											// Usa setTimeout per evitare conflitti con l'evento di selezione
											setTimeout(() => {
												dialog.set_value('task', ''); // Reset task selection
												frappe.msgprint({
													title: 'Accesso Negato',
													message: `Non puoi selezionare questa task perché non sei assegnato al progetto "${taskProject}". Contatta il tuo Project Manager per l'assegnazione al progetto.`,
													indicator: 'red'
												});
											}, 100);
										}
									}
								});
							} else {
								// Il progetto della task corrisponde a quello selezionato, non fare nulla
								// La task è valida per il progetto corrente
							}
						}
					}
				});
			}
		},
				click: function() {
					const project = dialog.get_value('project');
					const employee = dialog.get_value('employee');
					
					if (project && employee) {
						// Verifica se l'employee ha task per questo progetto
						frappe.call({
							method: 'advanced_tc.api.timesheet_details.check_employee_has_tasks',
							args: {
								employee: employee,
								project: project
							},
							callback: (r) => {
						if (!r.message) {
							frappe.show_alert('Contatta il tuo Project Manager per l\'assegnazione di un task.');
						}
					}
						});
					}
				}
				},
				{
					fieldtype: 'Link',
					fieldname: 'activity_type',
					label: 'Activity Type',
					options: 'Activity Type',
					default: event_data.activity_type
				},
				{
					fieldtype: 'Small Text',
					fieldname: 'description',
					label: 'Description',
					default: event_data.description
				}
			],
			primary_action_label: is_edit ? 'Update' : 'Create',
			primary_action: (values) => {
				if (is_edit) {
					this.update_activity_data(event.id, values, dialog);
				} else {
					this.create_activity(values, dialog);
				}
			}
		});
		
		// Aggiungi pulsante delete se è edit
		if (is_edit) {
			dialog.add_custom_action('Delete', () => {
				this.delete_activity(event.id, dialog);
			}, 'btn-danger');
		}
		
		// Sistema di debouncing per prevenire race conditions
		let timesheetUpdateTimeout = null;
		let lastTimesheetCall = null;
		
		// Funzione per gestire l'aggiornamento del timesheet con debouncing
		const updateTimesheet = (employee, fromTime, delay = 300) => {
			// Cancella il timeout precedente se esiste
			if (timesheetUpdateTimeout) {
				clearTimeout(timesheetUpdateTimeout);
			}
			
			// Crea una chiave unica per questa combinazione
			const callKey = `${employee}-${fromTime}`;
			
			// Se è la stessa chiamata dell'ultima, ignora
			if (lastTimesheetCall === callKey) {
				return;
			}
			
			timesheetUpdateTimeout = setTimeout(() => {
				if (employee && fromTime && !is_edit) {
					lastTimesheetCall = callKey;
					
					// Calcola l'inizio della settimana per la data dell'attività
					const activityDate = new Date(fromTime);
					const weekStart = this.getWeekStartDate(activityDate);
					const weekStartStr = weekStart.getFullYear() + '-' + 
										 String(weekStart.getMonth() + 1).padStart(2, '0') + '-' + 
										 String(weekStart.getDate()).padStart(2, '0');
					
					// Ottieni o crea il timesheet settimanale
					frappe.call({
						method: 'advanced_tc.api.timesheet_details.get_or_create_timesheet',
						args: {
							employee: employee,
							start_date: weekStartStr,
							company: frappe.defaults.get_user_default('Company') || frappe.defaults.get_global_default('default_company')
						},
						callback: (r) => {
							if (r.message && r.message.name) {
								dialog.set_value('timesheet', r.message.name);
							} else {
								// Lascia il campo timesheet vuoto, sarà gestito dal backend
								dialog.set_value('timesheet', '');
							}
							// Reset della chiave dopo il completamento
							lastTimesheetCall = null;
						}
					});
				}
			}, delay);
		};
		
		// Event listener per employee - rimuove le chiamate duplicate
		dialog.fields_dict.employee.df.onchange = () => {
			const employee = dialog.get_value('employee');
			
			if (employee) {
				// Reset project e task quando cambia employee
				dialog.set_value('project', '');
				dialog.set_value('task', '');
				
				// Aggiorna il timesheet con debouncing
				const fromTime = dialog.get_value('from_time');
				if (fromTime) {
					updateTimesheet(employee, fromTime);
				}
			}
		};
		
		// Flag per evitare il reset del task quando il progetto viene impostato automaticamente
		let projectSetByTask = false;
		
		// Event listener per project - resetta il task quando cambia progetto
		dialog.fields_dict.project.df.onchange = () => {
			const project = dialog.get_value('project');
			
			// Non resettare il task se il progetto è stato impostato automaticamente dalla selezione del task
			if (!projectSetByTask) {
				dialog.set_value('task', '');
			}
			
			// Reset della flag
			projectSetByTask = false;
			
			// Forza il refresh del filtro task
			setTimeout(() => {
				dialog.fields_dict.task.df.get_query = dialog.fields_dict.task.df.get_query;
				dialog.fields_dict.task.refresh();
			}, 200);
		};
		
		// Event listener esplicito per il click del campo task
		setTimeout(() => {
			if (dialog.fields_dict.task && dialog.fields_dict.task.$input) {
				dialog.fields_dict.task.$input.on('click', () => {
					const project = dialog.get_value('project');
					const employee = dialog.get_value('employee');
					
					if (project && employee) {
						// Verifica se l'employee ha task per questo progetto
						frappe.call({
							method: 'advanced_tc.api.timesheet_details.check_employee_has_tasks',
							args: {
								employee: employee,
								project: project
							},
							callback: (r) => {
								if (!r.message) {
									frappe.msgprint({
										title: 'Attenzione',
										message: 'Contatta il tuo Project Manager per l\'assegnazione di un task.',
										indicator: 'orange'
									});
								}
							}
						});
					}
				});
			}
		}, 500);
		
		// Event listener per from_time - utilizza debouncing
		dialog.fields_dict.from_time.df.onchange = () => {
			const employee = dialog.get_value('employee');
			const fromTime = dialog.get_value('from_time');
			
			if (employee && fromTime) {
				updateTimesheet(employee, fromTime);
			}
		};
		
		// Inizializzazione iniziale del timesheet se entrambi i valori sono già presenti
		setTimeout(() => {
			const employee = dialog.get_value('employee');
			const fromTime = dialog.get_value('from_time');
			
			if (employee && fromTime && !is_edit) {
				updateTimesheet(employee, fromTime, 100); // Delay ridotto per inizializzazione
			}
		}, 50);
		
		dialog.show();
	}

	// Metodi per gestire le impostazioni predefinite
	load_default_settings() {
		const saved_settings = localStorage.getItem('timesheet_default_settings');
		
		if (saved_settings) {
			try {
				const settings = JSON.parse(saved_settings);
				
				// Valida che tutti i campi necessari siano presenti e validi
				if (settings.default_break_start && settings.default_break_end && 
					settings.default_work_start && settings.default_work_end) {
					return settings;
				}
			} catch (e) {
				console.warn('Errore nel caricamento delle impostazioni salvate:', e);
			}
		}
		
		// Impostazioni predefinite di default
		return {
			default_break_start: '13:00:00',
			default_break_end: '14:00:00',
			default_work_start: '09:30:00',
			default_work_end: '18:30:00',
			auto_enable_break: true
		};
	}

	save_default_settings(settings) {
		// Normalizza gli orari al formato HH:MM (rimuovi i secondi se presenti)
		const normalized_settings = {
			default_work_start: settings.default_work_start.substring(0, 5),
			default_work_end: settings.default_work_end.substring(0, 5),
			default_break_start: settings.default_break_start.substring(0, 5),
			default_break_end: settings.default_break_end.substring(0, 5),
			auto_enable_break: settings.auto_enable_break
		};
		

		
		// Valida i formati degli orari dopo la normalizzazione
		const time_regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
		
		if (!time_regex.test(normalized_settings.default_work_start) || 
			!time_regex.test(normalized_settings.default_work_end) ||
			!time_regex.test(normalized_settings.default_break_start) ||
			!time_regex.test(normalized_settings.default_break_end)) {
			frappe.show_alert({
				message: 'Formato orario non valido. Utilizzare il formato HH:MM',
				indicator: 'red'
			}, 5);
			return;
		}
		
		localStorage.setItem('timesheet_default_settings', JSON.stringify(normalized_settings));
		this.default_settings = normalized_settings;
	}

	show_settings_dialog() {
		const dialog = new frappe.ui.Dialog({
			title: 'Impostazioni Predefinite Timesheet',
			fields: [
				{
					fieldtype: 'Section Break',
					label: 'Orari di Lavoro Predefiniti'
				},
				{
					fieldtype: 'Time',
					fieldname: 'default_work_start',
					label: 'Orario Inizio Lavoro',
					default: this.default_settings.default_work_start,
					description: 'Orario di inizio predefinito per una giornata lavorativa completa'
				},
				{
					fieldtype: 'Time',
					fieldname: 'default_work_end',
					label: 'Orario Fine Lavoro',
					default: this.default_settings.default_work_end,
					description: 'Orario di fine predefinito per una giornata lavorativa completa'
				},
				{
					fieldtype: 'Section Break',
					label: 'Pausa Pranzo Predefinita'
				},
				{
					fieldtype: 'Check',
					fieldname: 'auto_enable_break',
					label: 'Abilita Automaticamente Pausa',
					default: this.default_settings.auto_enable_break,
					description: 'Abilita automaticamente la pausa quando si crea una giornata lavorativa completa'
				},
				{
					fieldtype: 'Time',
					fieldname: 'default_break_start',
					label: 'Inizio Pausa',
					default: this.default_settings.default_break_start,
					description: 'Orario di inizio pausa predefinito'
				},
				{
					fieldtype: 'Time',
					fieldname: 'default_break_end',
					label: 'Fine Pausa',
					default: this.default_settings.default_break_end,
					description: 'Orario di fine pausa predefinito'
				}
			],
			primary_action_label: 'Salva Impostazioni',
			primary_action: (values) => {
				// Validazione fascia oraria di pausa (solo se auto_enable_break è attivato)
			if (values.auto_enable_break && values.default_break_start && values.default_break_end && 
				values.default_work_start && values.default_work_end) {
				
				// Converti gli orari in minuti per il confronto
				const timeToMinutes = (timeStr) => {
					const [hours, minutes] = timeStr.split(':').map(Number);
					return hours * 60 + minutes;
				};
				
				const workStart = timeToMinutes(values.default_work_start);
				const workEnd = timeToMinutes(values.default_work_end);
				const breakStart = timeToMinutes(values.default_break_start);
				const breakEnd = timeToMinutes(values.default_break_end);
				
				// Verifica che la pausa sia all'interno dell'orario lavorativo
				if (breakStart < workStart || breakEnd > workEnd || breakStart >= breakEnd) {
					frappe.msgprint({
						title: 'Errore di validazione',
						message: 'Fascia oraria di pausa al di fuori dell\'orario lavorativo.',
						indicator: 'red'
					});
					return; // Non salvare se la validazione fallisce
				}
			}
				
				this.save_default_settings(values);
				frappe.show_alert({
			message: 'Impostazioni salvate correttamente!',
			indicator: 'green'
		}, 4);
				dialog.hide();
			}
		});
		
		// Aggiungi pulsante per ripristinare valori predefiniti
		dialog.add_custom_action('Ripristina Default', () => {
			const default_values = {
				default_break_start: '13:00:00',
				default_break_end: '14:00:00',
				default_work_start: '09:30:00',
				default_work_end: '18:30:00',
				auto_enable_break: true
			};
			
			// Aggiorna i valori nel dialog
			Object.keys(default_values).forEach(key => {
				dialog.set_value(key, default_values[key]);
			});
			
			frappe.show_alert({
			message: 'Valori ripristinati ai default di fabbrica',
			indicator: 'blue'
		}, 4);
		}, 'btn-secondary');
		
		dialog.show();
	}

	// All'inizio della funzione show_activity_dialog, aggiungi:
	show_activity_dialog(event = null, start_time = null, end_time = null) {
	// Recupera l'employee ID per l'utente corrente
	frappe.call({
	method: 'frappe.client.get_list',
	args: {
	doctype: 'Employee',
	filters: {
	'user_id': frappe.session.user
	},
	fields: ['name']
	},
	callback: (r) => {
	const employee_id = r.message && r.message.length > 0 ? r.message[0].name : null;
	this.create_dialog.call(this, event, start_time, end_time, employee_id);
	}
	});
	}
	
	create_dialog(event, start_time, end_time, employee_id) {
	const is_edit = !!event;
	const event_data = event ? event.extendedProps : {};
	
	// Per l'edit, ottieni start e end dalle proprietà principali dell'evento
	const event_start = event ? event.start : null;
	const event_end = event ? event.end : null;
	
	// Determina se l'utente può selezionare altri employee con controllo errori
	let canSelectEmployee = true;
	let defaultEmployee = event_data.employee || employee_id || this.filters.employee || '';
	
	try {
		if (this.user_permissions && typeof this.user_permissions === 'object') {
			canSelectEmployee = !this.user_permissions.is_employee_only;
			if (this.user_permissions.is_employee_only && this.user_permissions.current_employee) {
				defaultEmployee = this.user_permissions.current_employee;
			}
		} else {
			console.warn('User permissions non disponibili nel dialog, permettendo selezione employee');
		}
	} catch (error) {
		console.error('Errore nel controllo permessi dialog:', error);
	}
	
	const dialog = new frappe.ui.Dialog({
	title: is_edit ? 'Edit Activity' : 'Add New Activity',
	fields: [
	{
	fieldtype: 'Link',
	fieldname: 'employee',
	label: 'Employee',
	options: 'Employee',
	reqd: 1,
	read_only: !canSelectEmployee,
	default: defaultEmployee
	},
	{
	fieldtype: 'Data',
	fieldname: 'timesheet',
	label: 'Timesheet',
	read_only: 1,
	hidden: 1,
	in_list_view: 0,
	print_hide: 1,
	default: event_data.timesheet || ''
	},
	{
	fieldtype: 'Datetime',
	fieldname: 'from_time',
	label: 'From Time',
	reqd: 1,
	default: start_time ? moment(start_time).format('YYYY-MM-DD HH:mm:ss') : 
			 (event_start ? moment(event_start).format('YYYY-MM-DD HH:mm:ss') : '')
	},
	{
	fieldtype: 'Datetime',
	fieldname: 'to_time',
	label: 'To Time',
	reqd: 1,
	default: end_time ? moment(end_time).format('YYYY-MM-DD HH:mm:ss') : 
			 (event_end ? moment(event_end).format('YYYY-MM-DD HH:mm:ss') : '')
	},
	{
	fieldtype: 'Section Break',
	label: 'Break Time (Optional)'
	},
	{
	fieldtype: 'Check',
	fieldname: 'has_break',
	label: 'Has Break Time',
	default: 0
	},
	{
	fieldtype: 'Time',
	fieldname: 'break_start',
	label: 'Break Start Time',
	depends_on: 'has_break',
	default: this.default_settings.default_break_start
	},
	{
	fieldtype: 'Time',
	fieldname: 'break_end',
	label: 'Break End Time',
	depends_on: 'has_break',
	default: this.default_settings.default_break_end
	},
	{
	fieldtype: 'Link',
	fieldname: 'project',
	label: 'Project',
	options: 'Project',
	default: event_data.project || this.filters.project || '',
	get_query: function() {
	return {
	query: 'advanced_tc.api.timesheet_details.get_employee_projects'
	};
	}
	},
	{
	fieldtype: 'Link',
	fieldname: 'task',
	label: 'Task',
	options: 'Task',
	default: event_data.task,
	get_query: function() {
		const project = dialog.get_value('project');
		const employee = dialog.get_value('employee');
		if (project && employee) {
			return {
				query: 'advanced_tc.api.timesheet_details.get_employee_tasks',
				filters: {
					'project': project,
					'employee': employee
				}
			};
		}
		return {
			filters: {
				'status': ['!=', 'Cancelled']
			}
		};
	},
	onchange: function() {
		const task = dialog.get_value('task');
		const employee = dialog.get_value('employee');
		if (task && employee) {
			// Ottieni il progetto della task
			frappe.call({
				method: 'advanced_tc.api.timesheet_details.get_task_project',
				args: { task_name: task },
				callback: (r) => {
					if (r.message) {
						const taskProject = r.message;
						
						// Verifica se l'employee è assegnato al progetto della task
						frappe.call({
							method: 'frappe.client.get_list',
							args: {
								doctype: 'ToDo',
								filters: {
									reference_type: 'Project',
									reference_name: taskProject,
									allocated_to: frappe.session.user,
									status: 'Open'
								},
								limit: 1
							},
							callback: (assignment_result) => {
								if (assignment_result.message && assignment_result.message.length > 0) {
									// L'employee è assegnato al progetto, può impostarlo
									projectSetByTask = true;
									dialog.set_value('project', taskProject);
								} else {
									// L'employee non è assegnato al progetto
									dialog.set_value('task', ''); // Reset task selection
									frappe.msgprint({
										title: 'Accesso Negato',
										message: `Non puoi selezionare questa task perché non sei assegnato al progetto "${taskProject}". Contatta il tuo Project Manager per l'assegnazione al progetto.`,
										indicator: 'red'
									});
								}
							}
						});
					}
				}
			});
		}
	},
	click: function() {
		const project = dialog.get_value('project');
		const employee = dialog.get_value('employee');
		
		if (project && employee) {
			// Verifica se l'employee ha task per questo progetto
			frappe.call({
				method: 'advanced_tc.api.timesheet_details.check_employee_has_tasks',
				args: {
					employee: employee,
					project: project
				},
				callback: (r) => {
					if (!r.message) {
						frappe.show_alert({
							message: 'Contatta il tuo Project Manager per l\'assegnazione di un task.',
							indicator: 'orange'
						}, 5);
					}
				}
			});
		}
	}
	},
	{
	fieldtype: 'Link',
	fieldname: 'activity_type',
	label: 'Activity Type',
	options: 'Activity Type',
	default: event_data.activity_type
	},
	{
	fieldtype: 'Small Text',
	fieldname: 'description',
	label: 'Description',
	default: event_data.description
	}
	],
	primary_action_label: is_edit ? 'Update' : 'Create',
	primary_action: (values) => {
	if (is_edit) {
	this.update_activity_data(event.id, values, dialog);
	} else {
	this.create_activity(values, dialog);
	}
	}
	});
	
	// Aggiungi pulsante delete se è edit
	if (is_edit) {
	dialog.add_custom_action('Delete', () => {
	this.delete_activity(event.id, dialog);
	}, 'btn-danger');
	}
	

	
	// Flag per evitare il reset del task quando il progetto viene impostato automaticamente
	let projectSetByTask = false;
	
	// Logica per resettare task quando cambia project
	dialog.fields_dict.project.df.onchange = () => {
	const project = dialog.get_value('project');
	
	// Non resettare il task se il progetto è stato impostato automaticamente dalla selezione del task
	if (!projectSetByTask) {
		dialog.set_value('task', '');
	}
	
	// Reset della flag
	projectSetByTask = false;
	
	// Forza il refresh del filtro task
	setTimeout(() => {
	dialog.fields_dict.task.df.get_query = dialog.fields_dict.task.df.get_query;
	dialog.fields_dict.task.refresh();
	}, 200);
	};
	
	// Event listener esplicito per il click del campo task
	setTimeout(() => {
		if (dialog.fields_dict.task && dialog.fields_dict.task.$input) {
			dialog.fields_dict.task.$input.on('click', () => {
				const project = dialog.get_value('project');
				const employee = dialog.get_value('employee');
				
				if (project && employee) {
					// Verifica se l'employee ha task per questo progetto
					frappe.call({
						method: 'advanced_tc.api.timesheet_details.check_employee_has_tasks',
						args: {
							employee: employee,
							project: project
						},
						callback: (r) => {
							if (!r.message) {
								frappe.msgprint({
									title: 'Attenzione',
									message: 'Contatta il tuo Project Manager per l\'assegnazione di un task.',
									indicator: 'orange'
								});
							}
						}
					});
				}
			});
		}
	}, 500);
	
	// Dopo la creazione del dialog, aggiungi questi event listeners:
	
	// Funzione per aggiornare i limiti dei datepicker delle pause
	const updateBreakTimeLimits = () => {
	const fromTime = dialog.get_value('from_time');
	const toTime = dialog.get_value('to_time');
	
	if (fromTime && toTime) {
	// Imposta i limiti per break_start
	const breakStartField = dialog.fields_dict.break_start;
	if (breakStartField && breakStartField.$input) {
	breakStartField.$input.attr('min', moment(fromTime).format('YYYY-MM-DDTHH:mm'));
	breakStartField.$input.attr('max', moment(toTime).format('YYYY-MM-DDTHH:mm'));
	}
	
	// Imposta i limiti per break_end
	const breakEndField = dialog.fields_dict.break_end;
	if (breakEndField && breakEndField.$input) {
	breakEndField.$input.attr('min', moment(fromTime).format('YYYY-MM-DDTHH:mm'));
	breakEndField.$input.attr('max', moment(toTime).format('YYYY-MM-DDTHH:mm'));
	}
	}
	};
	

	
	// Event listener per to_time
	dialog.fields_dict.to_time.df.onchange = () => {
	updateBreakTimeLimits();
	
	// Valida e correggi break_end se necessario
	const toTime = dialog.get_value('to_time');
	const breakEnd = dialog.get_value('break_end');
	
	if (toTime && breakEnd && moment(breakEnd).isAfter(moment(toTime))) {
	dialog.set_value('break_end', '');
	frappe.show_alert({
				message: 'Break end time reset: must be before activity end time',
				indicator: 'orange'
			}, 4);
	}
	};
	
	// Inizializza i limiti quando il dialog si apre
	setTimeout(() => {
		updateBreakTimeLimits();
	}, 100);

	// Event listener per has_break
	dialog.fields_dict.has_break.df.onchange = () => {
		const hasBreak = dialog.get_value('has_break');
		if (hasBreak) {
			dialog.set_df_property('break_start', 'hidden', 0);
			dialog.set_df_property('break_end', 'hidden', 0);
		} else {
			dialog.set_df_property('break_start', 'hidden', 1);
			dialog.set_df_property('break_end', 'hidden', 1);
			dialog.set_value('break_start', '');
			dialog.set_value('break_end', '');
		}
	};

	// Trigger the has_break change event to initialize the visibility
	dialog.fields_dict.has_break.df.onchange();
	
	// Inizializzazione iniziale del timesheet se entrambi i valori sono già presenti
	setTimeout(() => {
		const employee = dialog.get_value('employee');
		const fromTime = dialog.get_value('from_time');
		
		if (employee && fromTime && !is_edit) {
			updateTimesheetCD(employee, fromTime, 100); // Delay ridotto per inizializzazione
		}
	}, 50);

	// Event listener per break_start
	dialog.fields_dict.break_start.df.onchange = () => {
		const breakStart = dialog.get_value('break_start');
		const breakEnd = dialog.get_value('break_end');
		const fromTime = dialog.get_value('from_time');
		const toTime = dialog.get_value('to_time');
		
		if (breakStart && fromTime && toTime) {
			// Combina data dell'attività con orario del break
			const activityDate = moment(fromTime).format('YYYY-MM-DD');
			const breakStartDateTime = moment(`${activityDate} ${breakStart}:00`);
			const mainStart = moment(fromTime);
			const mainEnd = moment(toTime);
			
			// Valida che break_start sia dentro il range dell'attività
			if (breakStartDateTime.isBefore(mainStart) || breakStartDateTime.isAfter(mainEnd)) {
				dialog.set_value('break_start', '');
				frappe.show_alert({
				message: 'Break start must be within activity time range',
				indicator: 'orange'
			}, 4);
				return;
			}
			
			// Valida break_end se già impostato
			if (breakEnd) {
				const breakEndDateTime = moment(`${activityDate} ${breakEnd}:00`);
				if (breakEndDateTime.isBefore(breakStartDateTime)) {
					dialog.set_value('break_end', '');
					frappe.show_alert({
				message: 'Break end time reset: must be after break start time',
				indicator: 'orange'
			}, 4);
				}
			}
		}
	};

	// Event listener per break_end (ora Time field)
	dialog.fields_dict.break_end.df.onchange = () => {
		const breakEnd = dialog.get_value('break_end');
		const breakStart = dialog.get_value('break_start');
		const fromTime = dialog.get_value('from_time');
		const toTime = dialog.get_value('to_time');
		
		if (breakEnd && fromTime && toTime) {
			// Combina data dell'attività con orario del break
			const activityDate = moment(fromTime).format('YYYY-MM-DD');
			const breakEndDateTime = moment(`${activityDate} ${breakEnd}:00`);
			const mainStart = moment(fromTime);
			const mainEnd = moment(toTime);
			
			// Valida che break_end sia dentro il range dell'attività
			if (breakEndDateTime.isBefore(mainStart) || breakEndDateTime.isAfter(mainEnd)) {
				dialog.set_value('break_end', '');
				frappe.show_alert({
				message: 'Break end must be within activity time range',
				indicator: 'orange'
			}, 4);
				return;
			}
			
			// Valida che break_end sia dopo break_start
			if (breakStart) {
				const breakStartDateTime = moment(`${activityDate} ${breakStart}:00`);
				if (breakEndDateTime.isBefore(breakStartDateTime)) {
					dialog.set_value('break_end', '');
					frappe.show_alert({
				message: 'Break end must be after break start time',
				indicator: 'orange'
			}, 4);
					return;
				}
			}
		}
	};

	// Sistema di debouncing per prevenire race conditions (create_dialog)
	let timesheetUpdateTimeoutCD = null;
	let lastTimesheetCallCD = null;
	
	// Funzione per gestire l'aggiornamento del timesheet con debouncing (create_dialog)
	const updateTimesheetCD = (employee, fromTime, delay = 300) => {
		// Cancella il timeout precedente se esiste
		if (timesheetUpdateTimeoutCD) {
			clearTimeout(timesheetUpdateTimeoutCD);
		}
		
		// Crea una chiave unica per questa combinazione
		const callKey = `${employee}-${fromTime}`;
		
		// Se è la stessa chiamata dell'ultima, ignora
		if (lastTimesheetCallCD === callKey) {
			return;
		}
		
		timesheetUpdateTimeoutCD = setTimeout(() => {
			if (employee && fromTime && !is_edit) {
				lastTimesheetCallCD = callKey;
				
				// Calcola l'inizio della settimana per la data dell'attività
				const activityDate = new Date(fromTime);
				const weekStart = this.getWeekStartDate(activityDate);
				const weekStartStr = weekStart.getFullYear() + '-' + 
									 String(weekStart.getMonth() + 1).padStart(2, '0') + '-' + 
									 String(weekStart.getDate()).padStart(2, '0');
				
				// Ottieni o crea il timesheet settimanale
				frappe.call({
					method: 'advanced_tc.api.timesheet_details.get_or_create_timesheet',
					args: {
						employee: employee,
						start_date: weekStartStr,
						company: frappe.defaults.get_user_default('Company') || frappe.defaults.get_global_default('default_company')
					},
					callback: (r) => {
						if (r.message && r.message.name) {
							dialog.set_value('timesheet', r.message.name);
						} else {
							// Lascia il campo timesheet vuoto, sarà gestito dal backend
							dialog.set_value('timesheet', '');
						}
						// Reset della chiave dopo il completamento
						lastTimesheetCallCD = null;
					}
				});
			}
		}, delay);
	};
	
	// Event listener per employee
	dialog.fields_dict.employee.df.onchange = () => {
		const employee = dialog.get_value('employee');
		
		if (employee) {
			// Reset project e task quando cambia employee
			dialog.set_value('project', '');
			dialog.set_value('task', '');
			
			// Aggiorna il timesheet con debouncing
			const fromTime = dialog.get_value('from_time');
			if (fromTime) {
				updateTimesheetCD(employee, fromTime);
			}
		}
	};
	
	// Event listener per from_time per aggiornare il timesheet quando cambia la data
	dialog.fields_dict.from_time.df.onchange = () => {
		const employee = dialog.get_value('employee');
		const fromTime = dialog.get_value('from_time');
		
		if (employee && fromTime) {
			updateTimesheetCD(employee, fromTime);
		}
		
		// Aggiorna anche i limiti dei break times
		updateBreakTimeLimits();
	};

	dialog.show();
}



update_activity(event) {
// Converti in formato locale senza timezone
const formatLocalDateTime = (date) => {
const year = date.getFullYear();
const month = String(date.getMonth() + 1).padStart(2, '0');
const day = String(date.getDate()).padStart(2, '0');
const hours = String(date.getHours()).padStart(2, '0');
const minutes = String(date.getMinutes()).padStart(2, '0');
const seconds = String(date.getSeconds()).padStart(2, '0');
return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const data = {
from_time: formatLocalDateTime(event.start),
to_time: formatLocalDateTime(event.end)
};

this.update_activity_data(event.id, data);
}

create_activity(values, dialog) {
    
    // Se c'è una pausa, crea due attività separate
    if (values.has_break && values.break_start && values.break_end) {
        // Prima attività: dall'inizio alla pausa
        const firstActivity = { ...values };
        firstActivity.to_time = moment(values.from_time).format('YYYY-MM-DD') + ' ' + values.break_start;
        delete firstActivity.has_break;
        delete firstActivity.break_start;
        delete firstActivity.break_end;
        
        // Seconda attività: dalla pausa alla fine
        const secondActivity = { ...values };
        secondActivity.from_time = moment(values.from_time).format('YYYY-MM-DD') + ' ' + values.break_end;
        delete secondActivity.has_break;
        delete secondActivity.break_start;
        delete secondActivity.break_end;

        // Crea la prima attività
        
        frappe.call({
			method: 'advanced_tc.api.timesheet_details.create_timesheet_detail',
            args: {
                data: JSON.stringify(firstActivity)
            },
            callback: (r) => {
                if (r.message && r.message.success) {
                    // Se la prima attività è creata con successo, usa il timesheet restituito per la seconda
                    if (r.message.timesheet_name) {
                        secondActivity.timesheet = r.message.timesheet_name;
                    }
                    
                    frappe.call({
                        method: 'advanced_tc.api.timesheet_details.create_timesheet_detail',
                        args: {
                            data: JSON.stringify(secondActivity)
                        },
                        callback: (r2) => {
                            if (r2.message && r2.message.success) {
                                frappe.show_alert({
                                    message: 'Activities created successfully',
                                    indicator: 'green'
                                }, 4);
                                dialog.hide();
                                setTimeout(() => {
                                    this.calendar.refetchEvents();
                                }, 1500);
                            } else {
                                frappe.show_alert({
                                    message: 'Error creating second activity',
                                    indicator: 'red'
                                }, 5);
                            }
                        }
                    });
                } else {
                    frappe.show_alert({
                        message: 'Error creating first activity',
                        indicator: 'red'
                    }, 5);
                }
            }
        });
    } else {
        // Se non c'è pausa, crea una singola attività
        const activity = { ...values };
        delete activity.has_break;
        delete activity.break_start;
        delete activity.break_end;
        

        
        frappe.call({
            method: 'advanced_tc.api.timesheet_details.create_timesheet_detail',
            args: {
                data: JSON.stringify(activity)
            },
            callback: (r) => {
                if (r.message && r.message.success) {
                    frappe.show_alert({
                        message: 'Activity created successfully',
                        indicator: 'green'
                    }, 4);
                    dialog.hide();
                    setTimeout(() => {
                        this.calendar.refetchEvents();
                    }, 1500);
                } else {
                    frappe.show_alert({
                        message: 'Error creating activity',
                        indicator: 'red'
                    }, 5);
                }
            }
        });
    }
}

update_activity_data(id, data, dialog = null) {
    frappe.call({
				method: 'advanced_tc.api.timesheet_details.update_timesheet_detail',
        args: {
            name: id,
            data: JSON.stringify(data)
        },
        callback: (r) => {
            if (r.message && r.message.success) {
                if (dialog) dialog.hide();
                // Mostra il toast prima del refresh con durata molto lunga
                frappe.show_alert({
                    message: 'Attività aggiornata correttamente',
                    indicator: 'green'
                }, 4);
                setTimeout(() => {
                    this.calendar.refetchEvents();
                }, 1500);
            } else {
                frappe.show_alert({
                    message: 'Errore durante la modifica',
                    indicator: 'red'
                }, 5);
            }
        }
    });
}

delete_activity(id, dialog) {
		frappe.confirm(
			'Are you sure you want to delete this activity?',
			() => {
				frappe.call({
								method: 'advanced_tc.api.timesheet_details.delete_timesheet_detail',
					args: { name: id },
					callback: (r) => {
						if (r.message && r.message.success) {
							frappe.show_alert({
 								message: 'Activity deleted successfully',
 								indicator: 'green'
 							}, 4);
							dialog.hide();
							setTimeout(() => {
								this.calendar.refetchEvents();
							}, 1500);
						} else {
							frappe.show_alert({
 								message: 'Error deleting activity',
 								indicator: 'red'
 							}, 5);
						}
					}
				});
			}
		);
	}
	
	show_report_dialog() {
		// Ottieni gli eventi correnti dal calendario
		const events = this.calendar.getEvents();
		
		// Ottieni il range di date corrente
		const view = this.calendar.view;
		const startDate = view.activeStart;
		const endDate = view.activeEnd;
		
		// Chiama la funzione di summary dal file timesheet_calendar.js
		if (window.TimesheetCalendarUtils && window.TimesheetCalendarUtils.showSummaryDialog) {
			window.TimesheetCalendarUtils.showSummaryDialog(events, startDate, endDate);
		} else {
			frappe.show_alert({
			message: 'Report functionality not available',
			indicator: 'red'
		}, 5);
		}
	}
}