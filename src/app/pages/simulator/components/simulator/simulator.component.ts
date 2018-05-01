import {Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {Craft} from '../../../../model/garland-tools/craft';
import {Simulation} from '../../simulation/simulation';
import {Observable} from 'rxjs/Observable';
import {ReplaySubject} from 'rxjs/ReplaySubject';
import {CraftingAction} from '../../model/actions/crafting-action';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {CrafterStats} from '../../model/crafter-stats';
import {SimulationReliabilityReport} from '../../simulation/simulation-reliability-report';
import {SimulationResult} from '../../simulation/simulation-result';
import {ActionType} from '../../model/actions/action-type';
import {CraftingActionsRegistry} from '../../model/crafting-actions-registry';
import {ObservableMedia} from '@angular/flex-layout';
import {GearSet} from '../../model/gear-set';
import {UserService} from '../../../../core/database/user.service';
import {DataService} from '../../../../core/api/data.service';
import {HtmlToolsService} from '../../../../core/tools/html-tools.service';
import {EffectiveBuff} from '../../model/effective-buff';
import {Buff} from 'app/pages/simulator/model/buff.enum';
import {Consumable} from '../../model/consumable';
import {foods} from '../../../../core/data/sources/foods';
import {medicines} from '../../../../core/data/sources/medicines';
import {BonusType} from '../../model/consumable-bonus';
import {CraftingRotation} from '../../../../model/other/crafting-rotation';
import {CustomCraftingRotation} from '../../../../model/other/custom-crafting-rotation';

@Component({
    selector: 'app-simulator',
    templateUrl: './simulator.component.html',
    styleUrls: ['./simulator.component.scss']
})
export class SimulatorComponent implements OnInit {

    @Input()
    itemId: number;

    @Input()
    itemIcon: number;

    @Input()
    public customMode = false;

    private recipe$: ReplaySubject<Craft> = new ReplaySubject<Craft>(1);

    @Input()
    public set recipe(recipe: Craft) {
        this.recipe$.next(recipe);
    }

    private crafterStats$: ReplaySubject<CrafterStats> = new ReplaySubject<CrafterStats>(1);

    @Input()
    public set crafterStats(stats: CrafterStats) {
        this.crafterStats$.next(stats);
    }

    public actions$: BehaviorSubject<CraftingAction[]> = new BehaviorSubject<CraftingAction[]>([]);

    @Input()
    public set actions(actions: CraftingAction[]) {
        this.actions$.next(actions);
    }

    private hqIngredients$: BehaviorSubject<{ id: number, amount: number }[]> =
        new BehaviorSubject<{ id: number, amount: number }[]>([]);

    @Input()
    public set hqIngredients(ingredients: { id: number, amount: number }[]) {
        this.hqIngredients$.next(ingredients);
    }

    @Input()
    canSave = true;

    @Output()
    public onsave: EventEmitter<Partial<CraftingRotation>> = new EventEmitter<Partial<CraftingRotation>>();

    public simulation$: Observable<Simulation>;

    public result$: Observable<SimulationResult>;

    public report$: Observable<SimulationReliabilityReport>;

    public gearsets$: Observable<GearSet[]>;

    public customSet = false;

    public selectedSet: GearSet;

    @Input()
    public set inputGearSet(set: GearSet) {
        if (set !== undefined) {
            this.selectedSet = set;
            this.applyStats(set);
        }
    }

    @Input()
    public rotationId: string;

    public hqIngredientsData: { id: number, amount: number, max: number, quality: number }[] = [];

    public foods: Consumable[] = [];

    public selectedFood: Consumable;

    public medicines: Consumable[] = [];

    public selectedMedicine: Consumable;

    private serializedRotation: string[];

    private recipeSync: Craft;

    constructor(private registry: CraftingActionsRegistry, private media: ObservableMedia, private userService: UserService,
                private dataService: DataService, private htmlTools: HtmlToolsService) {

        this.foods = Consumable.fromData(foods);
        this.medicines = Consumable.fromData(medicines);

        this.actions$.subscribe(actions => {
            this.serializedRotation = this.registry.serializeRotation(actions);
        });

        this.recipe$.subscribe(recipe => {
            this.recipeSync = recipe;
            this.hqIngredientsData = recipe.ingredients
                .filter(i => i.id > 20)
                .map(ingredient => ({id: ingredient.id, amount: 0, max: ingredient.amount, quality: ingredient.quality}));
        });

        this.gearsets$ = this.userService.getUserData()
            .mergeMap(user => {
                if (user.anonymous) {
                    return Observable.of([])
                }
                return this.dataService.getGearsets(user.lodestoneId);
            });

        this.simulation$ = Observable.combineLatest(
            this.recipe$.distinctUntilChanged(),
            this.actions$.distinctUntilChanged(),
            this.crafterStats$,
            this.hqIngredients$,
            (recipe, actions, stats, hqIngredients) => new Simulation(recipe, actions, stats, hqIngredients)
        );

        this.result$ = this.simulation$.map(simulation => {
            simulation.reset();
            return simulation.run(true);
        });

        this.report$ = this.result$
            .debounceTime(500)
            .filter(res => res.success)
            .mergeMap(() => this.simulation$)
            .map(simulation => simulation.getReliabilityReport());
    }

    ngOnInit(): void {
        if (!this.customMode) {
            Observable.combineLatest(this.recipe$, this.gearsets$, (recipe, gearsets) => {
                let userSet = gearsets.find(set => set.jobId === recipe.job);
                if (userSet === undefined && this.selectedSet === undefined) {
                    userSet = {
                        ilvl: 0,
                        control: 1000,
                        craftsmanship: 1000,
                        cp: 450,
                        jobId: 10,
                        level: 70,
                        specialist: false
                    };
                }
                return userSet;
            }).subscribe(set => {
                this.selectedSet = set;
                this.applyStats(set);
            });
        }
    }

    save(): void {
        if (!this.customMode) {
            this.onsave.emit({
                $key: this.rotationId,
                rotation: this.serializedRotation,
                recipe: this.recipeSync
            });
        } else {
            this.onsave.emit(<CustomCraftingRotation>{
                $key: this.rotationId,
                stats: this.selectedSet,
                rotation: this.serializedRotation,
                recipe: this.recipeSync
            });
        }
    }

    getStars(nb: number): string {
        return this.htmlTools.generateStars(nb);
    }

    getBuffIcon(effBuff: EffectiveBuff): string {
        return `./assets/icons/status/${Buff[effBuff.buff].toLowerCase()}.png`;
    }

    moveSkill(originIndex: number, targetIndex: number): void {
        const actions = this.actions$.getValue();
        actions.splice(targetIndex, 0, actions.splice(originIndex, 1)[0]);
        this.actions$.next(actions);
        // If we can edit this rotation and it's a persisted one, autosave on edit
        if (this.canSave && this.rotationId !== undefined) {
            this.save();
        }
    }

    getBonusValue(bonusType: BonusType, baseValue: number): number {
        let bonusFromFood = 0;
        let bonusFromMedicine = 0;
        if (this.selectedFood !== undefined) {
            const foodBonus = this.selectedFood.getBonus(bonusType);
            if (foodBonus !== undefined) {
                bonusFromFood = Math.ceil(baseValue * foodBonus.value);
                if (bonusFromFood > foodBonus.max) {
                    bonusFromFood = foodBonus.max;
                }
            }
        }
        if (this.selectedMedicine !== undefined) {
            const medicineBonus = this.selectedMedicine.getBonus(bonusType);
            if (medicineBonus !== undefined) {
                bonusFromMedicine = Math.ceil(baseValue * medicineBonus.value);
                if (bonusFromMedicine > medicineBonus.max) {
                    bonusFromMedicine = medicineBonus.max;
                }
            }
        }
        return bonusFromFood + bonusFromMedicine;
    }

    applyStats(set: GearSet): void {
        this.crafterStats = new CrafterStats(
            set.jobId,
            set.craftsmanship + this.getBonusValue('Craftsmanship', set.craftsmanship),
            set.control + this.getBonusValue('Control', set.control),
            set.cp + this.getBonusValue('CP', set.cp),
            set.specialist,
            set.level);
    }

    addAction(action: CraftingAction): void {
        this.actions$.next(this.actions$.getValue().concat(action));
        // If we can edit this rotation and it's a persisted one, autosave on edit
        if (this.canSave && this.rotationId !== undefined) {
            this.save();
        }
    }

    removeAction(index: number): void {
        const rotation = this.actions$.getValue();
        rotation.splice(index, 1);
        this.actions$.next(rotation);
        // If we can edit this rotation and it's a persisted one, autosave on edit
        if (this.canSave && this.rotationId !== undefined) {
            this.save();
        }
    }

    getProgressActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.PROGRESSION);
    }

    getQualityActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.QUALITY);
    }

    getCpRecoveryActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.CP_RECOVERY);
    }

    getBuffActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.BUFF);
    }

    getSpecialtyActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.SPECIALTY);
    }

    getRepairActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.REPAIR);
    }

    getOtherActions(): CraftingAction[] {
        return this.registry.getActionsByType(ActionType.OTHER);
    }

    isMobile(): boolean {
        return this.media.isActive('xs') || this.media.isActive('sm');
    }
}
